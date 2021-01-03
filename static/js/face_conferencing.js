let myVid           = document.getElementById('myVid');
let myCanvas        = document.getElementById('myCanvas');
let myFaceCanvas    = document.getElementById('myFaceCanvas');
let peersDiv        = document.getElementById('peers');
let miniFaceSize    = 128;
myFaceCanvas.width  = miniFaceSize;
myFaceCanvas.height = miniFaceSize;
var myWidth, myHeight;
var facefinder;
var faceCX, faceCY, faceSize;
var targetFaceCX, targetFaceCY, targetFaceSize;
var myVidStream;
var myFaceStream    = myFaceCanvas.captureStream(30);
var myPeerName;
var roomName        = "room1";
var peers           = {};

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

faceapi.nets.tinyFaceDetector.loadFromUri('/static/models');

function faceDetect() {
  var detectStart = new Date();
  faceapi.detectSingleFace(myVid, new faceapi.TinyFaceDetectorOptions())
    .then(detection => {
      if (detection) {
        // console.log(detection);
        let box = detection.box;
        targetFaceCX   = (box.right + box.left) / 2;
        targetFaceCY   = (box.bottom + box.top) / 2;
        targetFaceSize = Math.max(box.width, box.height);
      }
      detectDuration = new Date() - detectStart;
      // console.log(detectDuration);
      // Target no more than 50% processing time spent on face detection.
      window.setTimeout(faceDetect, Math.max(detectDuration, 33));
    });
}

// The protocol is to:

// 1. Acquire a peer name by POSTing to /rooms/:room_name/peers

// 2. Poll /rooms/:room_name/peers

// 3. When a peer is listed that you haven't connected to, it is the
//   responsibility of the lexigraphically lower peer_name to offer, so:

// 4a. If other_peer_name < my_peer_name, then:
//   (i)  Post my JSON RTCPeerConnectionDescription offer to
//       /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/offers/MY_PEER_NAME
//   (ii) Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/answers/OTHER_PEER_NAME
//       for the answering description

// 4b. If other_peer_name > my_peer_name, then:
//   (i)  Poll /rooms/ROOM_NAME/peers/MY_PEER_NAME/offers/OTHER_PEER_NAME for the offer
//   (ii) Post my JSON RTCPeerConnectionDescription answer to
//       /rooms/ROOM_NAME/peers/OTHER_PEER_NAME/answers/MY_PEER_NAME

function acquirePeerName() {
  fetch('/rooms/' + roomName + '/peers', { method: 'POST' })
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    myPeerName = data.peer_name
    console.log(data);
    pollForPeers();
  }).catch(err => {
    console.warn("Couldn't acquire peer name", err);
    window.setTimeout(acquirePeerName, 3000);
  });
}

function pollForAnswerFrom(peerName) {
  fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/answers/' + peerName)
  .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
  .then(data => {
    console.log('Got answer from ' + peerName);
    peers[peerName].status = 'connected'
    peers[peerName].peerConn.ontrack = makeOnTrackHandler(peerName);
    window.setTimeout(() => pollForIceCandidates(peerName, 500), 500);
    peers[peerName].peerConn.setRemoteDescription(new RTCSessionDescription(data));
  }).catch(err => {
    console.log('Waiting for answer from ' + peerName, err);
    window.setTimeout(() => pollForAnswerFrom(peerName), 1000);
  });
}

function makeOnIceCandidateHandler(peerName) {
  return function (event) {
    if (event.candidate) {
      console.log(event.candidate.toJSON());
      fetch('/rooms/' + roomName + '/peers/' + peerName + '/ice_candidates/' + myPeerName, {
        method: 'POST',
        body: JSON.stringify(event.candidate.toJSON()),
        headers: { 'Content-Type': 'application/json' }
      })
      .then(resp => resp.ok ? resp :  Promise.reject(resp))
      .catch(err => {
        console.warn('Error sending ICE candidate to ' + peerName, err)
      });
    }
  };
}

function makeOnTrackHandler(peerName) {
  return function (event) {
    if (!peers[peerName].vidElem) {
      let vidElem = document.createElement("video");
      vidElem.autoplay = true;
      vidElem.width = miniFaceSize;
      vidElem.height = miniFaceSize;
      peersDiv.appendChild(vidElem);
      peers[peerName].vidElem = vidElem;
      vidElem.srcObject = event.streams[0];
    }
  }
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
        fetch('/rooms/' + roomName + '/peers/' + myPeerName + '/ice_candidates/' + peerName + '/' + candidateId)
        .then(resp => resp.ok ? resp.json() :  Promise.reject(resp))
        .then(data => {
          peers[peerName].peerConn.addIceCandidate(data);
        }).catch(err => {
          console.log("Error getting for ice candidate " + candidateId + " from " + peerName, err);
        });
      }
    });
    window.setTimeout(() => pollForIceCandidates(peerName, delayMs + 500), delayMs)
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
      peerConn.onicecandidate = makeOnIceCandidateHandler(peerName);
      peerConn.addTrack(myFaceStream.getVideoTracks()[0], myVidStream);
      peerConn.addTrack(myVidStream.getAudioTracks()[0], myVidStream);
      peers[peerName].peerConn = peerConn;
    }
    peerConn.ontrack = makeOnTrackHandler(peerName);
    window.setTimeout(() => pollForIceCandidates(peerName, 500), 500);
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
        console.warn('Error responding to offer', err)
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
              console.warn("Offer to " + peerName + " failed", err);
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

navigator.mediaDevices
  .getUserMedia({ audio: true, video: true })
  .then(stream => {
    myVidStream     = stream;
    myWidth         = stream.getVideoTracks()[0].getSettings().width;
    myHeight        = stream.getVideoTracks()[0].getSettings().height;
    myVid.width     = myWidth;
    myVid.height    = myHeight;
    myVid.srcObject = stream;
    faceCX          = myWidth / 2;
    faceCY          = myHeight / 2;
    faceSize        = Math.min(myWidth, myHeight);
    targetFaceCX    = faceCX;
    targetFaceCY    = faceCY;
    targetFaceSize  = faceSize;
  }).catch(e => console.log('getUserMedia: ', e));

myVid.addEventListener('playing', () => {
  // let myCtx = myCanvas.getContext('2d');
  let myFaceCtx = myFaceCanvas.getContext('2d');

  function onFrame() {
    // myCtx.drawImage(myVid, 0, 0);

    minDim = Math.min(myWidth, myHeight)

    dist = ((targetFaceCX - faceCX)**2 + (targetFaceCY - faceCY)**2 + (targetFaceSize - faceSize)**2)**0.5 / faceSize
    push = Math.min(dist*2.5, 1.0);
    faceCX   = (1.0 - push)*faceCX + push*targetFaceCX;
    faceCY   = (1.0 - push)*faceCY + push*targetFaceCY;
    faceSize = (1.0 - push)*faceSize + push*targetFaceSize;

    myFaceCtx.drawImage(myVid, faceCX - faceSize/2, faceCY - faceSize/2, faceSize, faceSize, 0, 0, 128, 128);

    requestAnimationFrame(onFrame);
  }

  requestAnimationFrame(onFrame);
  faceDetect();
  acquirePeerName();
});