
let gameW                     = 16*80
let gameH                     = 9*80
let gameDiv                   = document.getElementById('gameDiv');
gameDiv.style.width           = gameW;
gameDiv.style.height          = gameH;
gameDiv.style.backgroundImage = "url(/static/field.jpg)";


let defaultConstants = {
  playerGlideIdle      : 0.25,
  playerGlideMoving    : 0.00005,
  playerAccelMoving    : 2000,
  ballGlide            : 0.5,
  wallSpringConstant   : 100,
  objectSpringConstant : 200,
  networkFPS           : 30,
  maxForce             : 5000,
}

let me                  = {x : Math.random() * gameW, y : -50, vx : 0, vy : 0, glide : 0.25, radius : miniFaceSize / 2, mass : 1};
let ballElem            = document.createElement('img');
ballElem.src            = "/static/ball.png"
let ball                = {x : gameW / 2, y : gameH / 2, vx : 0, vy : 0, glide : 0.5, radius : miniFaceSize / 4, mass : 0.25};
ballElem.width          = 2 * ball.radius;
ballElem.height         = 2 * ball.radius;
ballElem.style.position = "absolute";
gameDiv.appendChild(ballElem);

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
    ball: ball,
    pole1: makePole( 45,         gameH/2 - 80),
    pole2: makePole( 45,         gameH/2 + 80),
    pole3: makePole( gameW - 45, gameH/2 - 80),
    pole4: makePole( gameW - 45, gameH/2 + 80),
  },
  constants : JSON.parse(JSON.stringify(defaultConstants))
};
let objectKeysToUpdate  = [];
let keysDown            = [];
let lastGameTime        = new Date();

let usedKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "s", "d", "w"];

Array.prototype.addAsSet = function(elem) {
  if (!this.includes(elem)) {
    this.push(elem);
  }
  console.log(this);
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

  let constants = gameState.constants;
  let clampForce = x => clamp(-constants.maxForce, constants.maxForce, x);

  var intendedVx = 0;
  var intendedVy = 0;

  if (keysDown.includes("ArrowLeft")  || keysDown.includes("a")) { intendedVx -= 1 };
  if (keysDown.includes("ArrowDown")  || keysDown.includes("s")) { intendedVy += 1 };
  if (keysDown.includes("ArrowRight") || keysDown.includes("d")) { intendedVx += 1 };
  if (keysDown.includes("ArrowUp")    || keysDown.includes("w")) { intendedVy -= 1 };

  let intendedHeading = atan2(intendedVy, intendedVx);
  let acceleration = constants.playerAccelMoving;

  if (intendedVx != 0 || intendedVy != 0) {
    me.vx += cos(intendedHeading) * acceleration * dt;
    me.vy += sin(intendedHeading) * acceleration * dt;
    me.glide = constants.playerGlideMoving;
  } else {
    me.glide = constants.playerGlideIdle;
  }
  // } else {
  //   me.vx = 0;
  //   me.vy = 0;
  // }

  let objects = gameState.objects;
  for (key in objects) {
    let object = objects[key];
    object.x += object.vx * dt;
    object.y += object.vy * dt;

    if (object.x - object.radius < 0) {
      object.vx += clampForce((0 - (object.x - object.radius)) * constants.wallSpringConstant) * dt;
    }
    if (object.x + object.radius > gameW) {
      object.vx -= clampForce(((object.x + object.radius) - gameW) * constants.wallSpringConstant) * dt;
    }
    if (object.y - object.radius < 0) {
      object.vy += clampForce((0 - (object.y - object.radius)) * constants.wallSpringConstant) * dt;
    }
    if (object.y + object.radius > gameH) {
      object.vy -= clampForce(((object.y + object.radius) - gameH) * constants.wallSpringConstant) * dt;
    }
  }

  // Circular spring physics. Bouncy, hehe.
  for (key1 in objects) {
    for (key2 in objects) {
      if (key1 < key2) {
        if ( key1 === "me" || key2 === "me" || (!(key1 in peers) && !(key2 in peers)) ) {
          let obj1 = objects[key1];
          let obj2 = objects[key2];

          let dx = obj2.x - obj1.x;
          let dy = obj2.y - obj1.y;

          let radiusSum = obj1.radius + obj2.radius;

          if (dx*dx + dy*dy < radiusSum * radiusSum) {
            if (key1 === "me" && !(key2 in peers)) {
              objectKeysToUpdate.addAsSet(key2);
            }
            if (key2 === "me" && !(key1 in peers)) {
              objectKeysToUpdate.addAsSet(key1);
            }

            let interDistance       = Math.sqrt(dx*dx + dy*dy);
            let penetrationDistance = radiusSum - interDistance;

            let unitDx = dx / interDistance;
            let unitDy = dy / interDistance;

            obj1.vx -= clampForce(penetrationDistance * constants.objectSpringConstant * unitDx) * dt / obj1.mass;
            obj1.vy -= clampForce(penetrationDistance * constants.objectSpringConstant * unitDy) * dt / obj1.mass;
            obj2.vx += clampForce(penetrationDistance * constants.objectSpringConstant * unitDx) * dt / obj2.mass;
            obj2.vy += clampForce(penetrationDistance * constants.objectSpringConstant * unitDy) * dt / obj2.mass;
          }
        }
      }
    }
  }

  for (key in objects) {
    let object = objects[key];
    object.vx *= Math.pow(object.glide, dt);
    object.vy *= Math.pow(object.glide, dt);
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
        update(localObj[localKey], remoteObj[remoteKey]);
      } else {
        localObj[localKey] = remoteObj[remoteKey];
      }
    }
  }
  update(gameState, remoteGameState);
}


var lastGameConstants = JSON.parse(JSON.stringify(gameState.constants));

function gameConstantsMatch(gc1, gc2) {
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

  // Send self, but with less glide for better intra-update prediction.
  let update = { objects: { me: {x : me.x, y : me.y, vx : me.vx, vy : me.vy, glide : (me.glide == gameState.constants.playerGlideMoving ? 1.0 : me.glide), radius : me.radius, mass : me.mass} } };

  // for (key in gameState.objects) {
  //   if (Math.random() < 0.0005) {
  //     objectKeysToUpdate.addAsSet(key);
  //   }
  // }

  objectKeysToUpdate.forEach(key => {
    update.objects[key] = gameState.objects[key];
  });
  objectKeysToUpdate.clear();

  if (!gameConstantsMatch(lastGameConstants, gameState.constants) || Math.random() < 0.0005) {
    update.constants = gameState.constants;
    // console.log(gameState.constants);
    lastGameConstants = JSON.parse(JSON.stringify(gameState.constants));
  }

  broadcast(update);

  window.setTimeout(broadcastStep, 1000 / gameState.constants.networkFPS);
}
window.setTimeout(broadcastStep, 100);

document.addEventListener("keydown", event => { keysDown.addAsSet(event.key);    if (usedKeys.includes(event.key)) { event.preventDefault() } });
document.addEventListener("keyup",   event => { keysDown.removeAsSet(event.key); if (usedKeys.includes(event.key)) { event.preventDefault() } });

document.getElementById("fullscreenButton").addEventListener("click", () => {
  gameDiv.requestFullscreen();
});

function tick() {
  gameStep();

  for (peerName in peers) {
    if (peerName in gameState.objects) {
      if (peers[peerName].vidElem) {
        peers[peerName].vidElem.style.left = Math.floor(gameState.objects[peerName].x - miniFaceSize / 2);
        peers[peerName].vidElem.style.top  = Math.floor(gameState.objects[peerName].y - miniFaceSize / 2);
      }
    }
  }
  myFaceCanvas.style.left = Math.floor(me.x - miniFaceSize / 2);
  myFaceCanvas.style.top  = Math.floor(me.y - miniFaceSize / 2);

  ballElem.style.left = Math.floor(ball.x - ball.radius);
  ballElem.style.top  = Math.floor(ball.y - ball.radius);

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
