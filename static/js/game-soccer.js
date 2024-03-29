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
  leftScore              : 0,
  rightScore             : 0,
  playerGlideIdle        : 0.25,
  playerGlideMoving      : 0.00002,
  playerAccelMoving      : 2300,
  playerRadius           : miniFaceSize / 2,
  playerMass             : 1,
  playerAsBallAccel      : 100,
  playerAsBallRadius     : Math.round(miniFaceSize / 3),
  kickOffAxisGlide       : 0.0005, // Easier dribbling/aiming by reducing ball motion that's off-axis from player motion.
  wallSpringConstant     : 100,
  objectSpringConstant   : 200,
  networkFPS             : 30,
  smoothingSeconds       : 0.2,
  maxSmoothingDistance   : 200,
  maxForce               : 2000,
  grrrringSoundLevel     : 0.25,
  grrrringTransientLevel : 0.6,
  grrrringBoost          : 2,
  faceSizeMultiplier     : 1.2, // Bigger is smaller.
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

// Creates object to store "me"'s constants
let me                  = {x : Math.random() * gameW, y : -50-defaultGlobals.playerRadius, vx : 0, vy : 0, glide : defaultGlobals.playerGlideIdle, radius : defaultGlobals.playerRadius, mass : defaultGlobals.playerMass, color: "black", isBall : false, grrrring: false, deflating: false, new: true};
let grrrrRemaining      = 2.0;
let grrrrStopTime       = new Date();
let ballElem            = document.createElement('img'); // creates image to insert into html
ballElem.src            = "/static/ball.png"
ballElem.width          = 2 * defaultBallParams.radius;
ballElem.height         = 2 * defaultBallParams.radius;
ballElem.style.position = "absolute";
gameDiv.appendChild(ballElem); // inserts image into html at end of gameDiv
let ballOverlayElems    = {};

function makePole(x, y) {
  let pole                       = {x : x, y : y, vx : 0, vy : 0, glide : 0, radius : miniFaceSize / 8, mass : 1000000};
  let poleElem                   = document.createElement('div');
  poleElem.style.width           = 2 * pole.radius;
  poleElem.style.height          = 2 * pole.radius;
  poleElem.style.position        = "absolute";
  poleElem.style.backgroundColor = "white";
  poleElem.style.borderRadius    = "" + pole.radius + "px"; // makes circle!
  poleElem.style.left            = x - pole.radius / 2;
  poleElem.style.top             = y - pole.radius / 2;
  gameDiv.appendChild(poleElem);
  return pole;
}

let gameState = { // has two keys, "objects" and "globals", which are synchronized between players
  objects: {
    me: me,
    ball: clone(defaultBallParams), // makes new object - he wrote clone himself - to not change defaults
    pole1: makePole( 45,         gameH/2 - 100),
    pole2: makePole( 45,         gameH/2 + 100),
    pole3: makePole( gameW - 45, gameH/2 - 100),
    pole4: makePole( gameW - 45, gameH/2 + 100),
  },
  globals : clone(defaultGlobals),
};
var globalsBroadcastProb = 1/30/gameState.globals.networkFPS;
let objectKeysIOwn = []; // last person to touch the ball is responsible for communicating where it is to other players
let keysDown       = []; // keyboard keys being pressed
let lastGameTime   = new Date(); // how much time since last physics update

let usedKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "s", "d", "w"];

Array.prototype.addAsSet = function(elem) { // pretend array is a set and add something to it
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

let cos   = deg    => Math.cos(deg / 180 * Math.PI) // degrees not radians!
let sin   = deg    => Math.sin(deg / 180 * Math.PI)
let atan2 = (y, x) => Math.atan2(y, x) / Math.PI * 180 // turns x,y coordinate into degrees from 0,0


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

function gameStep(now) {
  let dt = Math.min((now - lastGameTime) / 1000, 0.1);

  let globals = gameState.globals;
  let clampForce = x => clamp(-globals.maxForce, globals.maxForce, x);

  var intendedVx = 0;
  var intendedVy = 0;

  if (keysDown.includes("ArrowLeft")  || keysDown.includes("a")) { intendedVx -= 1 };
  if (keysDown.includes("ArrowDown")  || keysDown.includes("s")) { intendedVy += 1 };
  if (keysDown.includes("ArrowRight") || keysDown.includes("d")) { intendedVx += 1 };
  if (keysDown.includes("ArrowUp")    || keysDown.includes("w")) { intendedVy -= 1 };

  var grrrringMultiplier;
  if (grrrrRemaining > 0 && (quarterSecondMinSoundLevel > globals.grrrringSoundLevel || quarterSecondMaxSoundLevel > globals.grrrringTransientLevel)) {
    me.grrrring = true;
    grrrrRemaining -= dt;
    grrrrStopTime = now;
    // 2-4x boost.
    grrrringMultiplier = globals.grrrringBoost + globals.grrrringBoost * quarterSecondMaxSoundLevel
  } else {
    me.grrrring = false;
    if (now - grrrrStopTime >= 4000.0){
      grrrrRemaining += dt;
      grrrrRemaining = Math.min(grrrrRemaining,2.0);
    }
    grrrringMultiplier = 1.0;
  }

  if (!me.isBall) {
    let intendedHeading = atan2(intendedVy, intendedVx);
    let acceleration = globals.playerAccelMoving * grrrringMultiplier;

    if (intendedVx != 0 || intendedVy != 0) {
      me.vx += cos(intendedHeading) * acceleration * dt;
      me.vy += sin(intendedHeading) * acceleration * dt;
      me.glide = globals.playerGlideMoving;
    } else {
      me.glide = globals.playerGlideIdle;
    }
  } else {
    me.radius  = Math.round(Math.max(8, me.radius + intendedVx*grrrringMultiplier*60*dt));
    me.mass    = defaultBallParams.mass * me.radius * me.radius / (globals.playerAsBallRadius * globals.playerAsBallRadius);
    me.glide   = defaultBallParams.glide;
    if (intendedVy == 1) {
      me.glide *= 0.1;
    } else if (intendedVy == -1 && (me.vx*me.vx + me.vy*me.vy > 1)) {
      let heading = atan2(me.vy, me.vx);
      let acceleration = globals.playerAccelMoving * 0.1 * grrrringMultiplier;
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

    let effectiveRadius = object.radius;
    if (key === "ball"){
      effectiveRadius *= -1;
    }
    else if(object.isBall && (object.y < objects.pole1.y || object.y > objects.pole2.y)){
      effectiveRadius *= -1;
    }

    if (object.x + effectiveRadius < 0) {
      object.vx += clampForce((0 - (object.x + effectiveRadius)) * globals.wallSpringConstant) * dt;
    }
    if (object.x - effectiveRadius > gameW) {
      object.vx -= clampForce(((object.x - effectiveRadius) - gameW) * globals.wallSpringConstant) * dt;
    }
    if (object.y + effectiveRadius < 0) {
      object.vy += clampForce((0 - (object.y + effectiveRadius)) * globals.wallSpringConstant) * dt;
    }
    if (object.y - effectiveRadius > gameH) {
      object.vy -= clampForce(((object.y - effectiveRadius) - gameH) * globals.wallSpringConstant) * dt;
    }
  }

  // Check if scored (ball crosses either goal line)
  if ((!ball.disabled && objectKeysIOwn.includes("ball")) || me.isBall) {
    let ballY = 0.5 * (oldBallY + ball.y); // Reasonable guess without doing intersection math.
    if (oldBallX >= objects.pole1.x && ball.x < objects.pole1.x) {
      if (ballY < objects.pole2.y && ballY > objects.pole1.y) {
        // Score in the left goal
        gameState.globals.rightScore += 1;
        globalsBroadcastProb = 1.0;
        playDing();
        playAnim(rightScoreElem);
        // console.log(gameState.globals);
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
        globalsBroadcastProb = 1.0;
        playDing();
        playAnim(leftScoreElem);
        // console.log(gameState.globals);
        ball.x  = defaultBallParams.x;
        ball.y  = defaultBallParams.y;
        ball.vx = defaultBallParams.vx;
        ball.vy = defaultBallParams.vy;
      }
    }
  }

  // Circular spring physics. Bouncy, hehe.
  me.deflating = false;
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

            let interDistance       = Math.max(1, Math.sqrt(dx*dx + dy*dy));
            let penetrationDistance = radiusSum - interDistance;

            let unitDx = dx / interDistance;
            let unitDy = dy / interDistance;

            obj1.vx -= clampForce(penetrationDistance * globals.objectSpringConstant * unitDx) * dt / obj1.mass;
            obj1.vy -= clampForce(penetrationDistance * globals.objectSpringConstant * unitDy) * dt / obj1.mass;
            obj2.vx += clampForce(penetrationDistance * globals.objectSpringConstant * unitDx) * dt / obj2.mass;
            obj2.vy += clampForce(penetrationDistance * globals.objectSpringConstant * unitDy) * dt / obj2.mass;

            if (me.isBall && (key1 === "me" || key2 === "me")) {
              if (me.radius > maxBallRadius) {
                me.radius -= Math.round(2*60*dt);
                me.deflating = true;
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
      if (remoteKey === "globals") { me.new = false };
      let localKey = remoteKey === "me" ? peerName : remoteKey;
      if (!(localKey in localObj)) {
        localObj[localKey] = remoteObj[remoteKey];
      } else if (typeof remoteObj[remoteKey] === "object") {
        if (objectKeysIOwn.includes(localKey) && gameState.objects[peerName] && gameState.objects[localKey]) {
          // Only relinquish ownership if I think the object is closer to the peer in question.
          let dxMe   = gameState.objects.me.x        - gameState.objects[localKey].x;
          let dyMe   = gameState.objects.me.y        - gameState.objects[localKey].y;
          let dxPeer = gameState.objects[peerName].x - gameState.objects[localKey].x;
          let dyPeer = gameState.objects[peerName].y - gameState.objects[localKey].y;
          if (dxMe*dxMe + dyMe*dyMe > dxPeer*dxPeer + dyPeer*dyPeer) {
            objectKeysIOwn.removeAsSet(remoteKey);
            update(localObj[localKey], remoteObj[remoteKey]);
          } else {
            // Ownership conflict. Split the difference.
            gameState.objects[localKey].x  = 0.5 * (gameState.objects[localKey].x  + remoteObj[remoteKey].x)
            gameState.objects[localKey].y  = 0.5 * (gameState.objects[localKey].y  + remoteObj[remoteKey].y)
            gameState.objects[localKey].vx = 0.5 * (gameState.objects[localKey].vx + remoteObj[remoteKey].vx)
            gameState.objects[localKey].vy = 0.5 * (gameState.objects[localKey].vy + remoteObj[remoteKey].vy)
          }
        } else if ("vx" in remoteObj[remoteKey] && "vy" in remoteObj[remoteKey] && gameState.globals.smoothingSeconds > 0) {
            // Don't smooth non-moving objects, or objects far from their true position
            let remoteGameObj = remoteObj[remoteKey];
            let localGameObj  = localObj[localKey];
            let dx            = localGameObj.x - remoteGameObj.x;
            let dy            = localGameObj.y - remoteGameObj.y;
            if ( (remoteGameObj.vx === 0 && remoteGameObj.vy === 0) || (dx*dx + dy*dy) > gameState.globals.maxSmoothingDistance*gameState.globals.maxSmoothingDistance ) {
              update(localObj[localKey], remoteObj[remoteKey]);
            } else {
              // Smooth updates to other objects: try to reach the same point in smoothingSeconds
              let futureX = remoteGameObj.x + remoteGameObj.vx*gameState.globals.smoothingSeconds;
              let futureY = remoteGameObj.y + remoteGameObj.vy*gameState.globals.smoothingSeconds;
              let dfX = futureX - gameState.objects[localKey].x;
              let dfY = futureY - gameState.objects[localKey].y;
              gameState.objects[localKey].vx = dfX/gameState.globals.smoothingSeconds;
              gameState.objects[localKey].vy = dfY/gameState.globals.smoothingSeconds;
              delete remoteGameObj.x;
              delete remoteGameObj.y;
              delete remoteGameObj.vx;
              delete remoteGameObj.vy;
              update(localObj[localKey], remoteObj[remoteKey]);
            }
        } else {
          update(localObj[localKey], remoteObj[remoteKey]);
        }
      } else {
        localObj[localKey] = remoteObj[remoteKey];
      }
    }
  }
  if (remoteGameState?.globals) {
    console.log("received globals", clone(remoteGameState.globals));
  }
  if (remoteGameState?.globals?.leftScore  !== undefined && gameState.globals.leftScore  != remoteGameState?.globals?.leftScore) {
    playDing();
    playAnim(leftScoreElem);
  }
  if (remoteGameState?.globals?.rightScore !== undefined && gameState.globals.rightScore != remoteGameState?.globals?.rightScore) {
    playDing();
    playAnim(rightScoreElem);
  }
  update(gameState, remoteGameState);
}

function removePeerFromGame(peerName) {
  if (ballOverlayElems[peerName]) {
    ballOverlayElems[peerName].remove();
    delete ballOverlayElems[peerName];
  }
  delete gameState.objects[peerName];
}


// var lastGameGlobals = clone(gameState.globals);

// function gameGlobalsMatch(gc1, gc2) {
//   for (key in gc1) {
//     if (gc1[key] != gc2[key]) {
//       console.log(key);
//       return false;
//     }
//   }
//   for (key in gc2) {
//     if (!(key in gc1)) {
//       console.log(key);
//       return false;
//     }
//   }
//   return true;
// }

var updatesWithoutDeflating = 1000000;
function broadcastStep() {

  // Send self, but with more glide for better intra-update prediction.
  let update = { objects: { me: {x : me.x, y : me.y, vx : me.vx, vy : me.vy, glide : (me.glide == gameState.globals.playerGlideMoving ? 1.0 : me.glide), radius : me.radius, mass : me.mass, color : me.color, isBall : me.isBall, grrrring: me.grrrring, deflating: me.deflating, new: me.new} } };
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
  var anyDeflating = me.deflating;
  for (peerName in peers) {
    if (peerName in gameState.objects && gameState.objects[peerName].deflating) { anyDeflating = true; }
  }
  if (anyDeflating) {
    deflateAudio.play()
    updatesWithoutDeflating = 0;
  } else {
    updatesWithoutDeflating += 1;
    if (updatesWithoutDeflating / gameState.globals.networkFPS > 0.2) { deflateAudio.pause(); }
    if (updatesWithoutDeflating / gameState.globals.networkFPS > 0.7) { deflateAudio.currentTime = 0; }
  }


  objectKeysIOwn.forEach(key => {
    update.objects[key] = gameState.objects[key];
  });
  // objectKeysIOwn.clear();

  if (!me.new) {
    if (Math.random() <= globalsBroadcastProb) {
    // if (anyNew || !gameGlobalsMatch(lastGameGlobals, gameState.globals) || Math.random() <= globalsBroadcastProb) {
      update.globals = gameState.globals;
      console.log("sending globals", clone(gameState.globals));
      // lastGameGlobals = clone(gameState.globals);
    } else {
      for (peerName in peers) {
        if (peerName in gameState.objects && gameState.objects[peerName].new) {
          console.log("sending globals only to " + peerName, clone(gameState.globals));
          send_to_peer(peerName, JSON.stringify({ globals: gameState.globals }));
        }
      }
    }
  } else {
    // Are we the first player?
    if (myPeerName in peers && Object.keys(peers).length == 1) {
      me.new = false;
    }
    if (Math.random() <= globalsBroadcastProb) {
      me.new = false;
    }
  }

  // console.log("sending update", clone(update));
  broadcast(update);
  globalsBroadcastProb = Math.max(globalsBroadcastProb*0.7, 1/30/gameState.globals.networkFPS);

  window.setTimeout(broadcastStep, 1000 / gameState.globals.networkFPS);
}
window.setTimeout(broadcastStep, 100);

document.addEventListener("keydown", event => { keysDown.addAsSet(event.key);    if (usedKeys.includes(event.key)) { event.preventDefault() } });
document.addEventListener("keyup",   event => { keysDown.removeAsSet(event.key); if (usedKeys.includes(event.key)) { event.preventDefault() } });

function playDing() {
  dingAudio.currentTime = 0;
  dingAudio.play();
}
function playAnim(scoredPlayer) {
  //var colorrr = Math.random().toString().substr(2, 6);
  //scoredPlayer.style.background = "#" + colorrr;
  scoredPlayer.style.transition = "linear .2s" //this shouldn't be in the function
  scoredPlayer.style.boxShadow = "0px 0px 100px orange";
  scoredPlayer.style.transform = "scale(1.1)";
  setTimeout(() => {  
    scoredPlayer.style.boxShadow = "none"; 
    scoredPlayer.style.transform = "scale(1)"
  }, 500);
}

function stylePlayer(peerName, object, elem) {
  let borderWidth   = object.isBall ? Math.ceil(object.radius / 25) : 2;
  elem.style.width  = Math.round(object.radius * 2);
  elem.style.height = Math.round(object.radius * 2);

  var shakeX = 0;
  var shakeY = 0;
  if (object.grrrring) {
    shakeX = (-1 + 2*Math.random()) * object.radius / 10;
    shakeY = (-1 + 2*Math.random()) * object.radius / 10;
  }

  window.grrrr.style.marginLeft = shakeX;
  window.grrrr.style.marginRight = -1*shakeX;
  window.grrrr.style.marginTop = shakeY;
  window.grrrr.style.marginBottom = -1*shakeY;

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
  let now = new Date();
  gameStep(now);

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
  //grrrr.style.width        = grrrrRemaining * 50 + "px";
  grrrr.style.transform    = "scale(" + Math.sqrt(Math.max(grrrrRemaining/2,0)) + ")"

  let frameDuration = ((new Date()) - now) / 1000;
  window.setTimeout(tick, Math.max(1, (1/60 - frameDuration) * 1000));
}

function formatScore(score) {
  if (score < 10) {
    return "0" + score.toString();
  } else {
    return score.toString();
  }
}

window.addEventListener('DOMContentLoaded', (event) => { // when most of html is loaded, run this!
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

  // Text "choose a color" is placed in colorPicker span
  let colornote = document.createElement("span");
  let colortext = document.createTextNode("Choose a color!");
  colornote.appendChild(colortext);
  colornote.style.display = "inline-block";
  colornote.style.verticalAlign = "middle";
  colornote.style.margin = "0 1em";
  controls.appendChild(colornote);

  colors.forEach(color => {
    let swatch = document.createElement("span");
    swatch.style.backgroundColor = color;
    swatch.style.display = "inline-block";
    swatch.style.verticalAlign = "middle";
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
  ballButton.style.display = "inline-block";
  ballButton.style.verticalAlign = "middle";
  ballButton.style.margin = "0 1em";

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

  window.grrrr = document.createElement('span');
  window.grrrr.innerText = '"Grrrr!"';
  window.grrrr.style.display = "inline-block";
  window.grrrr.style.verticalAlign = "middle";
  window.grrrr.style.overflow = "hidden";
  controls.appendChild(window.grrrr);

  window.dingAudio = document.createElement('audio');
  window.dingAudio.src = "/static/ding.mp3"
  window.dingAudio.preload = "auto";
  window.dingAudio.volume = .2;
  controls.appendChild(window.dingAudio);

  window.deflateAudio = document.createElement('audio');
  window.deflateAudio.src = "/static/deflate_long.mp3"
  window.deflateAudio.preload = "auto";
  window.deflateAudio.volume = .2
  window.deflateAudio.loop = "true";
  controls.appendChild(window.deflateAudio);

  window.setTimeout(tick, 1);
});
