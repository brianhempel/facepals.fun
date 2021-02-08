
let gameW                     = 16*80
let gameH                     = 9*80
let gameDiv                   = document.getElementById('gameDiv');
gameDiv.style.width           = gameW;
gameDiv.style.height          = gameH;
gameDiv.style.backgroundImage = "url(/static/field.jpg)";


let defaultConstants = {
  playerInertiaIdle : 0.25,
  playerInertiaMoving : 0.00005,
  playerAccelMoving : 5000,
  ballInertia : 0.5,
  wallSpringConstant: 100,
  objectSpringConstant: 200,
  networkFPS : 20
}

let me                  = {x : Math.random() * gameW, y : -50, vx : 0, vy : 0, inertia : 0.25, radius : miniFaceSize / 2, mass : 1};
let ballElem            = document.createElement('img');
ballElem.src            = "/static/ball.png"
let ball                = {x : gameW / 2, y : gameH / 2, vx : 0, vy : 0, inertia : 0.5, radius : miniFaceSize / 4, mass : 0.25};
ballElem.width          = 2 * ball.radius;
ballElem.height         = 2 * ball.radius;
ballElem.style.position = "absolute";
gameDiv.appendChild(ballElem);

function makePoll(x, y) {
  let poll                       = {x : x, y : y, vx : 0, vy : 0, inertia : 0, radius : miniFaceSize / 8, mass : 1000000};
  let pollElem                   = document.createElement('div');
  pollElem.style.width           = 2 * poll.radius;
  pollElem.style.height          = 2 * poll.radius;
  pollElem.style.position        = "absolute";
  pollElem.style.backgroundColor = "white";
  pollElem.style.borderRadius    = "" + poll.radius + "px";
  pollElem.style.left            = x - poll.radius / 2;
  pollElem.style.top             = y - poll.radius / 2;
  gameDiv.appendChild(pollElem);
  return poll;
}

let gameState = {
  objects: {
    me: me,
    ball: ball,
    poll1: makePoll( 45,         gameH/2 - 80),
    poll2: makePoll( 45,         gameH/2 + 80),
    poll3: makePoll( gameW - 45, gameH/2 - 80),
    poll4: makePoll( gameW - 45, gameH/2 + 80),
  },
  constants : defaultConstants
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
  let dt = (now - lastGameTime) / 1000;

  var intendedVx = 0;
  var intendedVy = 0;

  if (keysDown.includes("ArrowLeft")  || keysDown.includes("a")) { intendedVx -= 1 };
  if (keysDown.includes("ArrowDown")  || keysDown.includes("s")) { intendedVy += 1 };
  if (keysDown.includes("ArrowRight") || keysDown.includes("d")) { intendedVx += 1 };
  if (keysDown.includes("ArrowUp")    || keysDown.includes("w")) { intendedVy -= 1 };

  let intendedHeading = atan2(intendedVy, intendedVx);
  let acceleration = gameState.constants.playerAccelMoving;

  if (intendedVx != 0 || intendedVy != 0) {
    me.vx += cos(intendedHeading) * acceleration * dt;
    me.vy += sin(intendedHeading) * acceleration * dt;
    me.inertia = gameState.constants.playerInertiaMoving;
  } else {
    me.inertia = gameState.constants.playerInertiaIdle;
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
      object.vx += (0 - (object.x - object.radius)) * gameState.constants.wallSpringConstant * dt;
    }
    if (object.x + object.radius > gameW) {
      object.vx -= ((object.x + object.radius) - gameW) * gameState.constants.wallSpringConstant * dt;
    }
    if (object.y - object.radius < 0) {
      object.vy += (0 - (object.y - object.radius)) * gameState.constants.wallSpringConstant * dt;
    }
    if (object.y + object.radius > gameH) {
      object.vy -= ((object.y + object.radius) - gameH) * gameState.constants.wallSpringConstant * dt;
    }
  }

  // Circular spring physics. Bouncy, hehe.
  for (key1 in objects) {
    for (key2 in objects) {
      if (key1 < key2) {
        let obj1 = objects[key1];
        let obj2 = objects[key2];

        let dx = obj2.x - obj1.x;
        let dy = obj2.y - obj1.y;

        let radiusSum = obj1.radius + obj2.radius;

        if (dx*dx + dy*dy < radiusSum * radiusSum) {
          if (key1 === "me" || key2 === "me") {
            if (key1 === "ball" || key2 === "ball") {
              objectKeysToUpdate.addAsSet("ball");
            }
          }

          let interDistance       = Math.sqrt(dx*dx + dy*dy);
          let penetrationDistance = radiusSum - interDistance;

          let unitDx = dx / interDistance;
          let unitDy = dy / interDistance;

          obj1.vx -= penetrationDistance * gameState.constants.objectSpringConstant * unitDx * dt / obj1.mass;
          obj2.vx += penetrationDistance * gameState.constants.objectSpringConstant * unitDx * dt / obj2.mass;
          obj1.vy -= penetrationDistance * gameState.constants.objectSpringConstant * unitDy * dt / obj1.mass;
          obj2.vy += penetrationDistance * gameState.constants.objectSpringConstant * unitDy * dt / obj2.mass;
        }
      }
    }
  }

  for (key in objects) {
    let object = objects[key];
    object.vx *= Math.pow(object.inertia, dt);
    object.vy *= Math.pow(object.inertia, dt);
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
function broadcastStep() {

  let update = { objects: { me: me } };

  for (key in gameState.objects) {
    if (Math.random() < 0.0005) {
      objectKeysToUpdate.addAsSet(key);
    }
  }

  objectKeysToUpdate.forEach(key => {
    update.objects[key] = gameState.objects[key];
  });
  objectKeysToUpdate.clear();

  if (lastGameConstants != gameState.constants || Math.random() < 0.0005) {
    update.constants = gameState.constants;
  }
  lastGameConstants = JSON.parse(JSON.stringify(gameState.constants));

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
      peers[peerName].vidElem.style.left = Math.floor(gameState.objects[peerName].x - miniFaceSize / 2);
      peers[peerName].vidElem.style.top  = Math.floor(gameState.objects[peerName].y - miniFaceSize / 2);
    }
  }
  myFaceCanvas.style.left = Math.floor(me.x - miniFaceSize / 2);
  myFaceCanvas.style.top  = Math.floor(me.y - miniFaceSize / 2);

  ballElem.style.left = Math.floor(ball.x - ball.radius);
  ballElem.style.top  = Math.floor(ball.y - ball.radius);

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
