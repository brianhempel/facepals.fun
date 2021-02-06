
let gameW        = 16*80
let gameH        = 9*80
let gameDiv      = document.getElementById('gameDiv');
gameDiv.style.width    = gameW;
gameDiv.style.height   = gameH;
let me           = {x : gameW / 2, y : gameH / 2, vx : 0, vy : 0};
let gameState    = { objects: { me: me } };
var lastUpdate   = {};
let keysDown     = [];
let lastGameTime = new Date();

let networkFPS = 20;

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
  let speed = 300;

  if (intendedVx != 0 || intendedVy != 0) {
    me.vx = cos(intendedHeading) * speed;
    me.vy = sin(intendedHeading) * speed;
  } else {
    me.vx = 0;
    me.vy = 0;
  }

  let objects = gameState.objects;
  for (key in gameState.objects) {
    object = objects[key];
    object.x += object.vx * dt;
    object.y += object.vy * dt;
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

function broadcastStep() {
  let update = { objects: { me: me } };
  // if (update !== lastUpdate) {
    broadcast(update);
  // }
  // lastUpdate = update
  window.setTimeout(broadcastStep, 1000 / networkFPS);
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

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
