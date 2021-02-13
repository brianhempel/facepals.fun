let myVid           = document.getElementById('myVid');
let myVidCanvas     = document.createElement('canvas');
var myVidCanvasCtx;
let myFaceCanvas    = document.getElementById('myFaceCanvas');
let miniFaceSize    = 64;
myFaceCanvas.width  = miniFaceSize;
myFaceCanvas.height = miniFaceSize;
myFaceCanvas.style.borderRadius = "" + (miniFaceSize / 2) + "px";
var myWidth, myHeight;
var faceDetectionWorker;
var faceCX, faceCY, faceSize;
var targetFaceCX, targetFaceCY, targetFaceSize;
var myVidStream;
var myFaceStream    = myFaceCanvas.captureStream(30);
var myPeerName;
var roomName        = window.location.href.match(/\/rooms\/([A-Za-z0-9'_!\-]+)/)[1];
var peers           = {};

// baseline idle 73.8
// no showing vid / face canvase 77.1
// no face detection 78.4
// and no circular clipping 79.5
// and no drawing on game canvas 91.3
// and no drawing on face canvas 93.1
// add back drawing on face canvas and face detection 89.9

const peerConnConfig = {
  iceServers: [
    {
      urls: 'stun:facepals.fun:5349'
    },
    {
      urls: 'turns:facepals.fun:5349',
      username: 'facepals',
      credential: 'facepalspwd'
    }
  ]
}

Array.prototype.maxBy = function(f) {
  var best_i    = -1;
  var best_val  = null;
  var best_elem = null;

  this.forEach( elem => {
    var val = f(elem);
    if (best_val === null || val > best_val) {
      best_val == val;
      best_elem = elem;
    }
  });

  return best_elem;
};


// The protocol is to:

// 1. Acquire a peer name by POSTing to /rooms/:room_name/peers

// 2. Poll /rooms/:room_name/peers

// 3. When a peer is listed that you haven't connected to, it is the
//   responsibility of the lexigraphically lower peer_name to offer, so:

// 4a. If other_peer_name < my_peer_name, then:
//   (i)  Post my JSON RTCPeerConnectionDescription offer to
//       /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/offers/MY_PEER_NAME
//   (ii) Add a data channel
//   (iii) Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/answers/OTHER_PEER_NAME
//       for the answering description

// 4b. If other_peer_name > my_peer_name, then:
//   (i)  Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/offers/OTHER_PEER_NAME for the offer
//   (ii) Listen for a data channel
//   (iii) Post my JSON RTCPeerConnectionDescription answer to
//        /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/answers/MY_PEER_NAME

function acquirePeerName() {
  fetch('/rooms/' + roomName + '/peers', { method: 'POST' })
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    myPeerName = data.peer_name;
    pollForPeers();
  }).catch(err => {
    console.warn("Couldn't acquire peer name", err);
    window.setTimeout(acquirePeerName, 3000);
  });

  // myPeerName = "69873513-46801558-cc6cfce0-e4830396";
  // pollForPeers();
}

function pollForAnswerFrom(peerName) {
  fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/answers/' + peerName)
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    console.log('Got answer from ' + peerName);
    peers[peerName].status = 'connected'
    peers[peerName].peerConn.ontrack = makeOnTrackHandler(peerName);
    window.setTimeout(() => pollForIceCandidates(peerName, 200), 200);
    peers[peerName].peerConn.setRemoteDescription(new RTCSessionDescription(data));
  }).catch(err => {
    console.log('Waiting for answer from ' + peerName, err);
    window.setTimeout(() => pollForAnswerFrom(peerName), 1000);
  });
}

function makeOnIceCandidateHandler(peerName) {
  let sendIceCandidate = candidateJson => {
    console.log(candidateJson);
    fetch('/rooms/' + roomName + '/peers/' + peerName + '/ice_candidates/' + myPeerName, {
      method: 'POST',
      body: JSON.stringify(candidateJson),
      headers: { 'Content-Type': 'application/json' }
    })
    .then(resp => resp.ok ? resp :  Promise.reject(resp))
    .catch(err => {
      console.error('Error sending ICE candidate to ' + peerName, err);
      window.setTimeout(() => sendIceCandidate(candidateJson), 500);
    });
  };
  return function (event) {
    if (event.candidate) {
      sendIceCandidate(event.candidate.toJSON());
    }
  };
}

function makeOnTrackHandler(peerName) {
  return function (event) {
    if (!peers[peerName].vidElem) {
      let vidElem                = document.createElement("video");
      vidElem.width              = miniFaceSize;
      vidElem.height             = miniFaceSize;
      document.getElementById('gameDiv').appendChild(vidElem);
      vidElem.style.borderRadius = "" + (miniFaceSize / 2) + "px";
      vidElem.style.position     = "absolute";
      peers[peerName].vidElem    = vidElem;
      vidElem.srcObject          = event.streams[0];
      vidElem.play();
    }
  };
}

function makeOnMessageHandler(peerName) {
  return function (event) {
    // Up to the game to implement this.
    // console.log("receiving ", event.data);
    handleMessage(peerName, JSON.parse(event.data));
  };
}

function broadcast(data) {
  for (peerName in peers) {
    // console.log(peers[peerName].dataChan);
    if (peers[peerName].dataChan && peers[peerName].dataChan.readyState === "open") {
      // console.log("broadcasting ", data);
      peers[peerName].dataChan.send(JSON.stringify(data));
    }
  }
};

function getIceCandidateData(peerName, candidateId) {
  fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/ice_candidates/' + peerName + '/' + candidateId)
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    peers[peerName].peerConn.addIceCandidate(data);
  }).catch(err => {
    console.error("Error getting ice candidate " + candidateId + " from " + peerName, err);
    window.setTimeout(() => getIceCandidateData(peerName, candidateId, 500));
  });
}

function pollForIceCandidates(peerName, delayMs) {
  if (!peers[peerName].iceCandidateIdsProcessed) {
    peers[peerName].iceCandidateIdsProcessed = [];
  }

  fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/ice_candidates/' + peerName)
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    data.ice_candidate_ids.forEach(candidateId => {
      if (!peers[peerName].iceCandidateIdsProcessed.includes(candidateId)) {
        peers[peerName].iceCandidateIdsProcessed.push(candidateId);
        getIceCandidateData(peerName, candidateId);
      }
    });
    window.setTimeout(() => pollForIceCandidates(peerName, Math.min(delayMs + 200, 5000)), delayMs)
  }).catch(err => {
    window.setTimeout(() => pollForIceCandidates(peerName, delayMs), delayMs)
    console.log("Error polling for ice candidate from " + peerName, err);
  });
}

function pollForOfferFrom(peerName) {
  fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/offers/' + peerName)
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    console.log('Got offer from ' + peerName);
    peers[peerName].status = 'answering';
    let peerConn = peers[peerName].peerConn || new RTCPeerConnection(peerConnConfig);
    if (!peers[peerName].peerConn) {
      peerConn.ondatachannel = event => {
        console.log("ondatachannel", event);
        peers[peerName].dataChan           = event.channel;
        peers[peerName].dataChan.onmessage = makeOnMessageHandler(peerName);
        peers[peerName].dataChan.onopen    = event => console.log("Channel opened to " + peerName);
        peers[peerName].dataChan.onclose   = event => console.log("Channel closed to " + peerName);
      };
      peerConn.onicecandidate  = makeOnIceCandidateHandler(peerName);
      peerConn.addTrack(myFaceStream.getVideoTracks()[0], myVidStream);
      peerConn.addTrack(myVidStream.getAudioTracks()[0], myVidStream);
      peers[peerName].peerConn = peerConn;
    }
    peerConn.ontrack = makeOnTrackHandler(peerName);
    window.setTimeout(() => pollForIceCandidates(peerName, 200), 200);
    peerConn.setRemoteDescription(new RTCSessionDescription(data));
    peerConn.createAnswer()
    .then(localConnDesc => {
      console.log("createAnswer localConnDesc");
      console.log(localConnDesc);
      peerConn.setLocalDescription(localConnDesc);
      return fetch('/rooms/' + roomName + '/peers/' + peerName + '/answers/' + myPeerName, {
        method: 'POST',
        body: JSON.stringify(localConnDesc),
        headers: { 'Content-Type': 'application/json' }
      });
    })
    .then(resp => resp.ok ? resp :  Promise.reject(resp))
    .catch(err => {
        console.error('Error responding to offer', err)
        pollForOfferFrom(peerName)
    });
  }).catch(err => {
    console.log('Waiting for offer from ' + peerName, err);
    window.setTimeout(() => pollForOfferFrom(peerName), 1000);
  });
}

function pollForPeers() {
  fetch('/rooms/' + roomName + '/peers')
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    // console.log(data);
    data.peers.forEach(peerName => {
      if (!peers[peerName]) {
        peers[peerName] = { status: 'new' };
      }
    });
    for (const peerName in peers) {
      // 3. When a peer is listed that you haven't connected to, it is the
      //   responsibility of the lexigraphically lower peer_name to offer, so:

      if (peers[peerName].status === 'new') {
        // 4a. If other_peer_name < my_peer_name, then:
        //   (i)  Post my JSON RTCPeerConnectionDescription offer to
        //        /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/offers/MY_PEER_NAME
        //   (ii) Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/answers/OTHER_PEER_NAME
        //        for the answering description
        if (peerName < myPeerName) {
          // makeOfferTo(peerName);
          peers[peerName].status = 'offering';
          let peerConn = peers[peerName].peerConn || new RTCPeerConnection(peerConnConfig);
          if (!peers[peerName].peerConn) {
            let dataChan             = peerConn.createDataChannel('channel to ' + peerName, { ordered: false, maxRetransmits: 0 });
            console.log(dataChan);
            dataChan.onmessage       = makeOnMessageHandler(peerName);
            dataChan.onopen          = event => console.log("Channel opened to " + peerName);
            dataChan.onclose         = event => console.log("Channel closed to " + peerName);
            peers[peerName].dataChan = dataChan;
            peerConn.onicecandidate = makeOnIceCandidateHandler(peerName);
            peerConn.addTrack(myFaceStream.getVideoTracks()[0], myVidStream);
            peerConn.addTrack(myVidStream.getAudioTracks()[0], myVidStream);
            peers[peerName].peerConn = peerConn;
          }
          peerConn
            .createOffer({
              offerToReceiveAudio: 1,
              offerToReceiveVideo: 1,
              voiceActivityDetection: true
            })
            .then(localConnDesc => {
              console.log(localConnDesc);
              console.log(localConnDesc.type);
              console.log(localConnDesc.sdp);
              peerConn.setLocalDescription(localConnDesc);
              return fetch('/rooms/' + roomName + '/peers/' + peerName + '/offers/' + myPeerName, {
                method: 'POST',
                body: JSON.stringify(localConnDesc),
                headers: { 'Content-Type': 'application/json' }
              });
            }).then(resp => resp.ok ? resp :  Promise.reject(resp))
            .then(resp => {
              console.log(resp);
              window.setTimeout(() => pollForAnswerFrom(peerName), 1000);
            }).catch(err => {
              console.error("Offer to " + peerName + " failed", err);
              peers[peerName].status = 'new';
            });

        } else if (peerName > myPeerName) {
          // 4b. If other_peer_name > my_peer_name, then:
          //   (i)  Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/offers/OTHER_PEER_NAME for the offer
          //   (ii) Post my JSON RTCPeerConnectionDescription answer to
          //       /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/answers/MY_PEER_NAME
          peers[peerName].status = 'waiting for offer';
          pollForOfferFrom(peerName);
        }
      }
    }
    window.setTimeout(pollForPeers, 3000)
  }).catch(err => {
    console.warn('Peers polling failure', err);
    window.setTimeout(pollForPeers, 3000);
  });
}


faceDetectionWorker = new Worker("/static/js/face_detection_worker.js");
faceDetectionWorker.addEventListener("message", ({ data }) => {
  // console.log(data);
  if (data.type === "ready") {
    askForFaceDetection();
  } else if (data.type === "faceLocation") {

    targetFaceCX    = data.location.faceCX;
    targetFaceCY    = data.location.faceCY;
    targetFaceSize  = data.location.faceSize;

    window.setTimeout(askForFaceDetection, 0.2*1000);
  } else if (data.type === "noFace") {
    window.setTimeout(askForFaceDetection, 0.2*1000);
  } else if (data.type === "error") {
    window.setTimeout(askForFaceDetection, 5*1000);
  }
});

function askForFaceDetection() {
  if (!myVid.paused) {
    myVidCanvasCtx.drawImage(myVid, 0, 0, myVidCanvas.width, myVidCanvas.height);
    faceDetectionWorker.postMessage({
      type      : 'detect',
      imageData : myVidCanvasCtx.getImageData(0, 0, myVidCanvas.width, myVidCanvas.height)
    });
  } else {
    window.setTimeout(askForFaceDetection, 0.5*1000);
  }
}


// cvSrc = null;
// cvCap = null;
// gray = null;
// faces = null;
// classifier = null;
// resp = null;
// cascadeFetched = false;

// fetch('/static/haarcascade_frontalface_default.xml')
//   .then(resp => resp.ok ? resp.arrayBuffer() :  Promise.reject(resp))
//   .then(buff => {
//     // console.log(data);
//     cv.FS_createDataFile('/', 'haarcascade_frontalface_default.xml', new Uint8Array(buff), true, false, false);
//     cascadeFetched = true;
//   }).catch(err => {
//     console.warn("Couldn't load haar cascade for face detector", err);
//   });

// function faceDetect() {
//   if (!cascadeFetched) {
//     window.setTimeout(faceDetect, 100);
//     return;
//   }

//   if (!cvCap) {
//     cvSrc = new cv.Mat(myVid.height, myVid.width, cv.CV_8UC4);
//     cvCap = new cv.VideoCapture(myVid);
//     gray  = new cv.Mat();
//     faces = new cv.RectVector();
//     classifier = new cv.CascadeClassifier();
//     classifier.load('haarcascade_frontalface_default.xml');
//   }

//   let detectStart = new Date();
//   try {
//     cvCap.read(cvSrc);
//     cv.cvtColor(cvSrc, gray, cv.COLOR_RGBA2GRAY, 0);
//     let maxSize  = Math.min(cvSrc.rows, cvSrc.cols);
//     let minSize = Math.ceil(maxSize / 4);
//     classifier.detectMultiScale(gray, faces, 1.1, 3, 0, new cv.Size(minSize, minSize));
//     // classifier.detectMultiScale(gray, faces, 1.05, 3, 0);
//     // console.log(faces);
//     var biggestFaceArea = 0;
//     for (let i = 0; i < faces.size(); ++i) {
//         let face = faces.get(i);
//         // console.log(face)
//         let area = face.width * face.height;
//         if (area > biggestFaceArea) {
//           targetFaceCX    = face.x + face.width / 2;
//           targetFaceCY    = face.y + face.height / 2;
//           targetFaceSize  = Math.max(face.width, face.height);
//           biggestFaceArea = area;
//         }
//     }
//     let detectDuration = new Date() - detectStart;
//     // console.log(detectDuration);
//     setTimeout(faceDetect, 0.2*1000);
//   } catch (err) {
//     console.log(err);
//     console.log(cv.exceptionFromPtr(err).msg);
//     setTimeout(faceDetect, 5000);
//   }
// }


window.addEventListener('DOMContentLoaded', (event) => {
  myVid.addEventListener('playing', () => {
    let myFaceCtx = myFaceCanvas.getContext('2d');

    function drawFace() {
      // myCtx.drawImage(myVid, 0, 0);

      minDim = Math.min(myWidth, myHeight)

      dist = ((targetFaceCX - faceCX)**2 + (targetFaceCY - faceCY)**2 + (targetFaceSize - faceSize)**2)**0.5 / faceSize
      push = Math.min(dist*0.5, 1.0);
      faceCX   = (1.0 - push)*faceCX + push*targetFaceCX;
      faceCY   = (1.0 - push)*faceCY + push*targetFaceCY;
      faceSize = (1.0 - push)*faceSize + push*targetFaceSize;

      myFaceCtx.drawImage(myVid, faceCX - faceSize/2, faceCY - faceSize/2, faceSize, faceSize, 0, 0, miniFaceSize, miniFaceSize);

      // window.setTimeout(drawFace, 1000 / 60);
      window.setTimeout(drawFace, 1000 / 40);
    }

    window.setTimeout(drawFace, 100);
    // window.setTimeout(faceDetect, 500);
    acquirePeerName();
  });

  navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: { width: 384, height: 288 } })
    .then(stream => {
      myVidStream               = stream;
      myWidth                   = stream.getVideoTracks()[0].getSettings().width;
      myHeight                  = stream.getVideoTracks()[0].getSettings().height;
      myVid.width               = myWidth;
      myVid.height              = myHeight;
      myVid.srcObject           = stream;
      myVidCanvas.width         = myWidth;
      myVidCanvas.height        = myHeight;
      myVidCanvas.style.display = 'none';
      document.body.appendChild(myVidCanvas);
      myVidCanvasCtx            = myVidCanvas.getContext('2d');
      faceCX                    = myWidth / 2;
      faceCY                    = myHeight / 2;
      faceSize                  = Math.min(myWidth, myHeight);
      targetFaceCX              = faceCX;
      targetFaceCY              = faceCY;
      targetFaceSize            = faceSize;
      console.log(stream.getVideoTracks()[0].getSettings())
      console.log(stream.getAudioTracks()[0].getSettings())
      myVid.play();
    }).catch(e => console.error('getUserMedia: ', e));
});

