
importScripts('opencv.js');

cv = cv();

cvSrc = null;
cvCap = null;
gray = null;
faces = null;
classifier = null;
resp = null;

cv.onRuntimeInitialized = () => {
  fetch('/static/haarcascade_frontalface_default.xml')
  .then(resp => resp.ok ? resp.arrayBuffer() :  Promise.reject(resp))
  .then(buff => {
    // console.log(data);
    cv.FS_createDataFile('/', 'haarcascade_frontalface_default.xml', new Uint8Array(buff), true, false, false);
    // cascadeFetched = true;

    // cvSrc = new cv.Mat(myVid.height, myVid.width, cv.CV_8UC4);
    // cvCap = new cv.VideoCapture(myVid);
    gray  = new cv.Mat();
    faces = new cv.RectVector();
    classifier = new cv.CascadeClassifier();
    classifier.load('haarcascade_frontalface_default.xml');

    self.postMessage({ type: 'ready' });

  }).catch(err => {
    console.warn("Couldn't load haar cascade for face detector", err);
  });
};

self.addEventListener('message', ({ data }) => {
  faceDetect(data.imageData);
});


function faceDetect(imageData) {

  let detectStart = new Date();
  try {

    if (!cvSrc) {
      cvSrc = cv.matFromImageData(imageData);
    } else {
      cvSrc.data.set(imageData.data);
    }
    cv.cvtColor(cvSrc, gray, cv.COLOR_RGBA2GRAY, 0);
    let maxSize         = Math.min(cvSrc.rows, cvSrc.cols);
    let minSize         = Math.ceil(maxSize / 4);
    classifier.detectMultiScale(gray, faces, 1.1, 3, 0, new cv.Size(minSize, minSize));
    // classifier.detectMultiScale(gray, faces, 1.05, 3, 0);
    // console.log(faces);
    var biggestFaceArea = 0;
    var faceCX    = null;
    var faceCY    = null;
    var faceSize  = null;
    for (let i = 0; i < faces.size(); ++i) {
        let face = faces.get(i);
        // console.log(face)
        let area = face.width * face.height;
        if (area > biggestFaceArea) {
          faceCX    = face.x + face.width / 2;
          faceCY    = face.y + face.height / 2;
          faceSize  = Math.max(face.width, face.height);
          biggestFaceArea = area;
        }
    }
    let detectDuration  = new Date() - detectStart;
    // console.log(detectDuration);

    if (biggestFaceArea > 0) {
      self.postMessage({
        type: 'faceLocation',
        location: {
          faceCX    : faceCX,
          faceCY    : faceCY,
          faceSize  : faceSize,
        }
      });
    } else {
      self.postMessage({ type: 'noFace' });
    }

  } catch (err) {
    self.postMessage({ type: 'error' });
    console.log(err);
    console.log(cv.exceptionFromPtr(err).msg);
  }
}