function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}


let gameW                     = 16*80
let gameH                     = 9*80
let gameDiv                   = document.getElementById('gameDiv');
let rightScoreElem            = document.getElementById('rightScore');
let leftScoreElem             = document.getElementById('leftScore');
gameDiv.style.width           = gameW;
gameDiv.style.height          = gameH;
gameDiv.style.backgroundImage = "url(/static/field.jpg)";


let defaultGlobals = {
  leftScore            : 0,
  rightScore           : 0,
  playerGlideIdle      : 0.25,
  playerGlideMoving    : 0.00002,
  playerAccelMoving    : 2300,
  playerRadius         : miniFaceSize / 2,
  playerMass           : 1,
  playerAsBallAccel    : 100,
  playerAsBallRadius   : Math.round(miniFaceSize / 3),
  kickOffAxisGlide     : 0.0005, // Easier dribbling/aiming by reducing ball motion that's off-axis from player motion.
  wallSpringConstant   : 100,
  objectSpringConstant : 200,
  networkFPS           : 30,
  maxForce             : 2000,
  onFireSoundLevel     : 0.25,
  onFireTransientLevel : 0.6,
  onFireBoost          : 2,
  faceSizeMultiplier   : 1.2, // Bigger is smaller.
}

let defaultBallParams = {
  x        : gameW / 2,
  y        : gameH / 2,
  vx       : 0,
  vy       : 0,
  glide    : 0.5,
  radius   : miniFaceSize / 4,
  mass     : 0.25,
  disabled : false,
}


let me                  = {x : Math.random() * gameW, y : -50-defaultGlobals.playerRadius, vx : 0, vy : 0, glide : defaultGlobals.playerGlideIdle, radius : defaultGlobals.playerRadius, mass : defaultGlobals.playerMass, color: "black", isBall : false, onFire: false};
let ballElem            = document.createElement('img');
ballElem.src            = "/static/ball.png"
ballElem.width          = 2 * defaultBallParams.radius;
ballElem.height         = 2 * defaultBallParams.radius;
ballElem.style.position = "absolute";
gameDiv.appendChild(ballElem);
let ballOverlayElems    = {};

function makePole(x, y) {
  let pole                       = {x : x, y : y, vx : 0, vy : 0, glide : 0, radius : miniFaceSize / 8, mass : 1000000};
  let poleElem                   = document.createElement('div');
  poleElem.style.width           = 2 * pole.radius;
  poleElem.style.height          = 2 * pole.radius;
  poleElem.style.position        = "absolute";
  poleElem.style.backgroundColor = "white";
  poleElem.style.borderRadius    = "" + pole.radius + "px";
  poleElem.style.left            = x - pole.radius / 2;
  poleElem.style.top             = y - pole.radius / 2;
  gameDiv.appendChild(poleElem);
  return pole;
}

let gameState = {
  objects: {
    me: me,
    ball: clone(defaultBallParams),
    pole1: makePole( 45,         gameH/2 - 100),
    pole2: makePole( 45,         gameH/2 + 100),
    pole3: makePole( gameW - 45, gameH/2 - 100),
    pole4: makePole( gameW - 45, gameH/2 + 100),
  },
  globals : clone(defaultGlobals),
};
let objectKeysIOwn = [];
let keysDown       = [];
let lastGameTime   = new Date();

let usedKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "s", "d", "w"];

Array.prototype.addAsSet = function(elem) {
  if (!this.includes(elem)) {
    this.push(elem);
  }
  // console.log(this);
  return this;
};

Array.prototype.removeAsSet = function(elem) {
  // https://love2dev.com/blog/javascript-remove-from-array/#remove-from-array-splice-value
  for (var i = 0; i < this.length; i += 1) {
    if (this[i] === elem) {
      this.splice(i, 1);
      i -= 1;
    }
  }
  // console.log(this);
  return this;
};

Array.prototype.clear = function() {
  this.splice(0, this.length);
  return this;
};

function clamp(lo, hi, x) {
  return Math.max(lo, Math.min(hi, x));
}

let cos   = deg    => Math.cos(deg / 180 * Math.PI)
let sin   = deg    => Math.sin(deg / 180 * Math.PI)
let atan2 = (y, x) => Math.atan2(y, x) / Math.PI * 180


// function drawFrame() {
//   function drawFace (image, positioning) {
//     // ctx.save();
//     // ctx.beginPath();
//     // ctx.arc(positioning.x, positioning.y, miniFaceSize/2, 0, Math.PI * 2, true);
//     // ctx.clip();
//     // ctx.drawImage(image, positioning.x - miniFaceSize/2, positioning.y - miniFaceSize/2);
//     // ctx.restore();
//   }

//   for (peerName in peers) {
//     if (peerName in gameState.objects) {
//       drawFace(peers[peerName].vidElem, gameState.objects[peerName])
//     }
//   }

//   drawFace(myFaceCanvas, me);

//   window.setTimeout(drawFrame, 1000 / renderFPS);
// }

function gameStep() {
  let now = new Date();
  let dt = Math.min((now - lastGameTime) / 1000, 0.1);

  let globals = gameState.globals;
  let clampForce = x => clamp(-globals.maxForce, globals.maxForce, x);

  var intendedVx = 0;
  var intendedVy = 0;

  if (keysDown.includes("ArrowLeft")  || keysDown.includes("a")) { intendedVx -= 1 };
  if (keysDown.includes("ArrowDown")  || keysDown.includes("s")) { intendedVy += 1 };
  if (keysDown.includes("ArrowRight") || keysDown.includes("d")) { intendedVx += 1 };
  if (keysDown.includes("ArrowUp")    || keysDown.includes("w")) { intendedVy -= 1 };

  var onFireMultiplier;
  if (quarterSecondMinSoundLevel > globals.onFireSoundLevel || quarterSecondMaxSoundLevel > globals.onFireTransientLevel) {
    me.onFire = true;
    // 2-4x boost.
    onFireMultiplier = globals.onFireBoost + globals.onFireBoost * quarterSecondMaxSoundLevel
  } else {
    me.onFire = false;
    onFireMultiplier = 1.0;
  }

  if (!me.isBall) {
    let intendedHeading = atan2(intendedVy, intendedVx);
    let acceleration = globals.playerAccelMoving * onFireMultiplier;

    if (intendedVx != 0 || intendedVy != 0) {
      me.vx += cos(intendedHeading) * acceleration * dt;
      me.vy += sin(intendedHeading) * acceleration * dt;
      me.glide = globals.playerGlideMoving;
    } else {
      me.glide = globals.playerGlideIdle;
    }
  } else {
    me.radius  = Math.max(8, me.radius + intendedVx);
    me.mass    = defaultBallParams.mass * me.radius * me.radius / (globals.playerAsBallRadius * globals.playerAsBallRadius);
    me.glide   = defaultBallParams.glide;
    if (intendedVy == 1) {
      me.glide *= 0.1;
    } else if (intendedVy == -1 && (me.vx*me.vx + me.vy*me.vy > 1)) {
      let heading = atan2(me.vy, me.vx);
      let acceleration = globals.playerAccelMoving * 0.1 * onFireMultiplier;
      me.vx += cos(heading) * acceleration * dt;
      me.vy += sin(heading) * acceleration * dt;
    }
    // console.log(me);
  }

  let objects     = gameState.objects;
  let ball        = me.isBall ? me : objects.ball;
  let oldBallX    = ball.x;
  let oldBallY    = ball.y;
  let maxBallRadius = 0.5*(objects.pole2.y - objects.pole1.y) - objects.pole1.radius;

  for (key in objects) {
    let object = objects[key];
    object.x += object.vx * dt;
    object.y += object.vy * dt;

    if (object.x + object.radius < 0) {
      object.vx += clampForce((0 - (object.x + object.radius)) * globals.wallSpringConstant) * dt;
    }
    if (object.x - object.radius > gameW) {
      object.vx -= clampForce(((object.x - object.radius) - gameW) * globals.wallSpringConstant) * dt;
    }
    if (object.y + object.radius < 0) {
      object.vy += clampForce((0 - (object.y + object.radius)) * globals.wallSpringConstant) * dt;
    }
    if (object.y - object.radius > gameH) {
      object.vy -= clampForce(((object.y - object.radius) - gameH) * globals.wallSpringConstant) * dt;
    }
  }

  // Check if scored (ball crosses either goal line)
  if (!ball.disabled || me.isBall) {
    let ballY = 0.5 * (oldBallY + ball.y); // Reasonable guess without doing intersection math.
    if (oldBallX >= objects.pole1.x && ball.x < objects.pole1.x) {
      if (ballY < objects.pole2.y && ballY > objects.pole1.y) {
        // Score in the left goal
        gameState.globals.rightScore += 1;
        console.log(gameState.globals);
        ball.x  = defaultBallParams.x;
        ball.y  = defaultBallParams.y;
        ball.vx = defaultBallParams.vx;
        ball.vy = defaultBallParams.vy;
      }
    }
    if (oldBallX <= objects.pole3.x && ball.x > objects.pole3.x) {
      if (ballY < objects.pole4.y && ballY > objects.pole3.y) {
        // Score in the right goal
        gameState.globals.leftScore += 1;
        console.log(gameState.globals);
        ball.x  = defaultBallParams.x;
        ball.y  = defaultBallParams.y;
        ball.vx = defaultBallParams.vx;
        ball.vy = defaultBallParams.vy;
      }
    }
  }

  // Circular spring physics. Bouncy, hehe.
  for (key1 in objects) {
    for (key2 in objects) {
      if (key1 < key2) {
        if ( key1 === "me" || key2 === "me" || (!(key1 in peers) && !(key2 in peers)) ) {
          let obj1 = objects[key1];
          let obj2 = objects[key2];
          if (obj1.disabled || obj2.disabled) {continue;}

          let dx = obj2.x - obj1.x;
          let dy = obj2.y - obj1.y;

          let radiusSum = obj1.radius + obj2.radius;

          if (dx*dx + dy*dy < radiusSum * radiusSum) {
            if (key1 === "me" && !(key2 in peers)) {
              objectKeysIOwn.addAsSet(key2);
            }
            if (key2 === "me" && !(key1 in peers)) {
              objectKeysIOwn.addAsSet(key1);
            }

            let interDistance       = Math.sqrt(dx*dx + dy*dy);
            let penetrationDistance = radiusSum - interDistance;

            let unitDx = dx / interDistance;
            let unitDy = dy / interDistance;

            obj1.vx -= clampForce(penetrationDistance * globals.objectSpringConstant * unitDx) * dt / obj1.mass;
            obj1.vy -= clampForce(penetrationDistance * globals.objectSpringConstant * unitDy) * dt / obj1.mass;
            obj2.vx += clampForce(penetrationDistance * globals.objectSpringConstant * unitDx) * dt / obj2.mass;
            obj2.vy += clampForce(penetrationDistance * globals.objectSpringConstant * unitDy) * dt / obj2.mass;

            if (me.isBall && (key1 === "me" || key2 === "me")) {
              if (me.radius > maxBallRadius) {
                me.radius -= 2;
              }
            }

            // "Kick" in direction of motion by slowing down object in off-axis motion
            if (((key1 === "ball" || obj1.isBall) && !(key2 === "ball" || obj2.isBall)) || ((key2 === "ball" || obj2.isBall) && !(key1 === "ball" || obj1.isBall))) {
              let ballObj = (key1 === "ball" || obj1.isBall) ? obj1 : obj2;
              let kicker  = (key1 === "ball" || obj1.isBall) ? obj2 : obj1;

              let kickerSpeed = Math.sqrt(kicker.vx*kicker.vx + kicker.vy*kicker.vy);
              if (kickerSpeed > 0) {
                let unitVx = kicker.vx / kickerSpeed;
                let unitVy = kicker.vy / kickerSpeed;

                let offAxisSpeed = ballObj.vx * -unitVy + ballObj.vy * unitVx;
                let offAxisVx = offAxisSpeed * -unitVy;
                let offAxisVy = offAxisSpeed * unitVx;

                let multiplier = 1.0 - Math.pow(globals.kickOffAxisGlide, dt);
                ballObj.vx -= offAxisVx * multiplier;
                ballObj.vy -= offAxisVy * multiplier;
              }
            }
          }
        }
      }
    }
  }

  for (key in objects) {
    let object = objects[key];
    let multiplier = Math.pow(object.glide, dt)
    object.vx *= multiplier;
    object.vy *= multiplier;
  }

  lastGameTime = now;
}

function handleMessage(peerName, remoteGameState) {
  function update(localObj, remoteObj) {
    for (remoteKey in remoteObj) {
      let localKey = remoteKey === "me" ? peerName : remoteKey;
      if (!(localKey in localObj)) {
        localObj[localKey] = remoteObj[remoteKey];
      } else if (typeof remoteObj[remoteKey] === "object") {
        if (objectKeysIOwn.includes(remoteKey) && gameState.objects[peerName] && gameState.objects[remoteKey]) {
          // Only relinquish ownership if I think the object is closer to the peer in question.
          let dxMe   = gameState.objects.me.x        - gameState.objects[remoteKey].x;
          let dyMe   = gameState.objects.me.y        - gameState.objects[remoteKey].y;
          let dxPeer = gameState.objects[peerName].x - gameState.objects[remoteKey].x;
          let dyPeer = gameState.objects[peerName].y - gameState.objects[remoteKey].y;
          if (dxMe*dxMe + dyMe*dyMe > dxPeer*dxPeer + dyPeer*dyPeer) {
            objectKeysIOwn.removeAsSet(remoteKey);
            update(localObj[localKey], remoteObj[remoteKey]);
          } else {
            // Ownership conflict. Split the difference.
            gameState.objects[remoteKey].x  = 0.5 * (gameState.objects[remoteKey].x  + remoteObj[remoteKey].x)
            gameState.objects[remoteKey].y  = 0.5 * (gameState.objects[remoteKey].y  + remoteObj[remoteKey].y)
            gameState.objects[remoteKey].vx = 0.5 * (gameState.objects[remoteKey].vx + remoteObj[remoteKey].vx)
            gameState.objects[remoteKey].vy = 0.5 * (gameState.objects[remoteKey].vy + remoteObj[remoteKey].vy)
          }
        } else {
          update(localObj[localKey], remoteObj[remoteKey]);
        }
      } else {
        localObj[localKey] = remoteObj[remoteKey];
      }
    }
  }
  update(gameState, remoteGameState);
}

function removePeerFromGame(peerName) {
  delete gameState.objects[peerName];
}


var lastGameGlobals = clone(gameState.globals);

function gameGlobalsMatch(gc1, gc2) {
  for (key in gc1) {
    if (gc1[key] != gc2[key]) {
      console.log(key);
      return false;
    }
  }
  for (key in gc2) {
    if (!(key in gc1)) {
      console.log(key);
      return false;
    }
  }
  return true;
}

function broadcastStep() {

  // Send self, but with more glide for better intra-update prediction.
  let update = { objects: { me: {x : me.x, y : me.y, vx : me.vx, vy : me.vy, glide : (me.glide == gameState.globals.playerGlideMoving ? 1.0 : me.glide), radius : me.radius, mass : me.mass, color : me.color, isBall : me.isBall, onFire: me.onFire} } };
  let ball = gameState.objects.ball;

  if (ball.disabled) {
    var anyBalls = me.isBall;
    for (peerName in peers) {
      if (peerName in gameState.objects && gameState.objects[peerName].isBall) { anyBalls = true; }
    }
    if (!anyBalls) {
      ball.disabled = false;
      gameState.objects.ball = clone(defaultBallParams);
      objectKeysIOwn.addAsSet("ball");
    }
  } else if (me.isBall && !ball.disabled) {
    ball.disabled = true;
    objectKeysIOwn.addAsSet("ball");
  } else if (objectKeysIOwn.includes("ball")) {
    var anyBalls = me.isBall;
    for (peerName in peers) {
      if (peerName in gameState.objects && gameState.objects[peerName].isBall) { anyBalls = true; }
    }
    if (anyBalls) { ball.disabled = true; }
  }

  objectKeysIOwn.forEach(key => {
    update.objects[key] = gameState.objects[key];
  });
  // objectKeysIOwn.clear();

  if (!gameGlobalsMatch(lastGameGlobals, gameState.globals) || Math.random() < 0.0005) {
    update.globals = gameState.globals;
    // console.log(gameState.globals);
    lastGameGlobals = clone(gameState.globals);
  }

  broadcast(update);

  window.setTimeout(broadcastStep, 1000 / gameState.globals.networkFPS);
}
window.setTimeout(broadcastStep, 100);

document.addEventListener("keydown", event => { keysDown.addAsSet(event.key);    if (usedKeys.includes(event.key)) { event.preventDefault() } });
document.addEventListener("keyup",   event => { keysDown.removeAsSet(event.key); if (usedKeys.includes(event.key)) { event.preventDefault() } });

function stylePlayer(peerName, object, elem) {
  let borderWidth   = object.isBall ? Math.ceil(object.radius / 25) : 2;
  elem.style.width  = Math.round(object.radius * 2);
  elem.style.height = Math.round(object.radius * 2);

  var shakeX = 0;
  var shakeY = 0;
  if (object.onFire) {
    shakeX = (-1 + 2*Math.random()) * object.radius / 10;
    shakeY = (-1 + 2*Math.random()) * object.radius / 10;
  }

  if (object.isBall) {
    elem.style.boxSizing      = "border-box";
    elem.style.left           = Math.floor(object.x - object.radius + shakeX);
    elem.style.top            = Math.floor(object.y - object.radius + shakeY);
    elem.style.border         = "solid";
    elem.style.borderColor    = "black";
    elem.style.borderWidth    = "" + borderWidth + "px";
    elem.style.borderRadius   = "" + Math.round(object.radius - 1) + "px";
    if (!ballOverlayElems[peerName]) {
      ballOverlayElems[peerName]                = document.createElement("img");
      ballOverlayElems[peerName].src            = "/static/playerBallOverlay.png"
      ballOverlayElems[peerName].style.position = "absolute";
      // ballOverlayElems[peerName].style.opacity  = "0.33";
      elem.after(ballOverlayElems[peerName]);
    }
    let overlayElem           = ballOverlayElems[peerName];
    overlayElem.style.display = "inline-block";
    overlayElem.style.width   = elem.style.width;
    overlayElem.style.height  = elem.style.height;
    overlayElem.style.left    = elem.style.left;
    overlayElem.style.top     = elem.style.top;
  } else {
    elem.style.boxSizing    = "content-box";
    elem.style.left         = Math.floor(object.x - object.radius - borderWidth + shakeX);
    elem.style.top          = Math.floor(object.y - object.radius - borderWidth + shakeY);
    elem.style.border       = "solid";
    elem.style.borderColor  = object.color;
    elem.style.borderWidth  = "" + borderWidth + "px";
    elem.style.borderRadius = "" + Math.round(object.radius + borderWidth - 1) + "px";
    if (ballOverlayElems[peerName]) {
      ballOverlayElems[peerName].style.display = "none";
    }
  }
}

function tick() {
  gameStep();

  for (peerName in peers) {
    if (peerName in gameState.objects) {
      if (peers[peerName].vidElem) {
        stylePlayer(peerName, gameState.objects[peerName], peers[peerName].vidElem);
        // peers[peerName].vidElem.style.left        = Math.floor(gameState.objects[peerName].x - miniFaceSize / 2);
        // peers[peerName].vidElem.style.top         = Math.floor(gameState.objects[peerName].y - miniFaceSize / 2);
        // peers[peerName].vidElem.style.borderColor = gameState.objects[peerName].color;
      }
    }
  }
  stylePlayer("me", me, myFaceCanvas);
  // myFaceCanvas.style.left = Math.floor(me.x - miniFaceSize / 2);
  // myFaceCanvas.style.top  = Math.floor(me.y - miniFaceSize / 2);

  let ball = gameState.objects.ball;
  if (!ball.disabled) {
    ballElem.style.display = "inline-block";
    ballElem.style.left = Math.floor(ball.x - ball.radius);
    ballElem.style.top  = Math.floor(ball.y - ball.radius);
  } else {
    ballElem.style.display = "none";
    ballElem.style.left = Math.floor(ball.x - ball.radius);
    ballElem.style.top  = Math.floor(ball.y - ball.radius);
  }

  // Update score elements
  leftScoreElem.innerText  = formatScore(gameState.globals.leftScore);
  rightScoreElem.innerText = formatScore(gameState.globals.rightScore);

  requestAnimationFrame(tick);
}

function formatScore(score) {
  if (score < 10) {
    return "0" + score.toString();
  } else {
    return score.toString();
  }
}

requestAnimationFrame(tick);

window.addEventListener('DOMContentLoaded', (event) => {
  let colors = ["black", "#ddd", "blue", "#a0a", "maroon", "#e70", "#cc0", "#0a0", "#0cc"];

  let controls = document.createElement('p');

  let colorPicker = document.createElement('span');

  // colorPicker.style.display = "inline-block";

  let restyleSwatches = () => {
    colorPicker.childNodes.forEach(swatch => {
      if (me.color === swatch.style.backgroundColor) {
        swatch.style.borderColor = "white";
      } else {
        swatch.style.borderColor = "transparent";
      }
    });
  };

  colors.forEach(color => {
    let swatch = document.createElement("span");
    swatch.style.backgroundColor = color;
    swatch.style.display = "inline-block";
    swatch.style.width = "55px";
    swatch.style.height = "30px";
    swatch.style.cursor = "pointer";
    swatch.style.border = "5px solid transparent";
    swatch.onclick = function (event) {
      me.color = event.target.style.backgroundColor;
      myFaceCanvas.style.borderColor = me.color;
      restyleSwatches();
      event.stopPropagation();
    };
    colorPicker.appendChild(swatch);
  });
  restyleSwatches();

  gameDiv.after(controls);

  controls.appendChild(colorPicker);

  let ballButton = document.createElement('button');
  ballButton.innerText = "I'm the ball!";
  ballButton.style.margin = "0 1em";
  ballButton.style.verticalAlign = "super";

  ballButton.addEventListener('click', event => {
    if ( me.isBall ) {
      me.isBall = false;
      me.radius = gameState.globals.playerRadius;
      me.mass   = gameState.globals.playerMass;
      ballButton.innerText = "I'm the ball!"
    } else {
      me.isBall = true;
      me.glide  = defaultBallParams.glide;
      me.radius = gameState.globals.playerAsBallRadius;
      ballButton.innerText = "I'm not the ball!"
    }
  });

  controls.appendChild(ballButton);

  let grrrr = document.createElement('span');
  grrrr.innerText = '"Grrrr!"';
  grrrr.style.verticalAlign = "super";
  controls.appendChild(grrrr);
});
