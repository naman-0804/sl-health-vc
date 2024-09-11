import React, { useEffect, useRef, useState } from "react";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";
import TextField from "@material-ui/core/TextField";
import AssignmentIcon from "@material-ui/icons/Assignment";
import PhoneIcon from "@material-ui/icons/Phone";
import { CopyToClipboard } from "react-copy-to-clipboard";
import Peer from "simple-peer";
import io from "socket.io-client";
import "./App.css";
import { Hands, HAND_CONNECTIONS } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import * as tf from "@tensorflow/tfjs";
import axios from 'axios';

// Initialize socket connection
const socket = io.connect(/*"http://localhost:5000/"*/"https://sl-health.onrender.com/"); // Update if needed

function App() {
  const [me, setMe] = useState("");
  const [stream, setStream] = useState();
  const [receivingCall, setReceivingCall] = useState(false);
  const [caller, setCaller] = useState("");
  const [callerSignal, setCallerSignal] = useState();
  const [callAccepted, setCallAccepted] = useState(false);
  const [idToCall, setIdToCall] = useState("");
  const [callEnded, setCallEnded] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [transcript, setTranscript] = useState([]);
  const myVideo = useRef();
  const userVideo = useRef();
  const canvasRef = useRef();
  const modelRef = useRef(null);
  const connectionRef = useRef();

  // Load TensorFlow model and handle role-based logic
  useEffect(() => {
    const loadModel = async () => {
      try {
        modelRef.current = await tf.loadLayersModel("/model.json");
        console.log("Model loaded successfully");
      } catch (error) {
        console.error("Error loading model:", error);
      }
    };

    // Fetch socket ID
    socket.on("me", (id) => {
      setMe(id);
    });

    // Handle incoming calls
    socket.on("callUser", (data) => {
      setReceivingCall(true);
      setCaller(data.from);
      setName(data.name);
      setCallerSignal(data.signal);
    });

    loadModel();

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, []);

  // Handle role-based media streams and predictions
  useEffect(() => {
    if (role === "patient") {
      const onResults = (results) => {
        const canvasElement = canvasRef.current;
        const canvasCtx = canvasElement.getContext("2d");
  
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
  
        if (results.multiHandLandmarks) {
          for (const landmarks of results.multiHandLandmarks) {
            drawHand(canvasCtx, landmarks, HAND_CONNECTIONS);
            makePrediction(landmarks);
          }
        }
  
        canvasCtx.restore();
      };
  
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: false })
        .then((currentStream) => {
          setStream(currentStream);
          myVideo.current.srcObject = currentStream;
  
          const hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
          });
  
          hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
  
          hands.onResults(onResults);
  
          const camera = new Camera(myVideo.current, {
            onFrame: async () => {
              await hands.send({ image: myVideo.current });
            },
            width: 1280,
            height: 720,
          });
  
          camera.start();
        })
        .catch((error) => {
          console.error("Error accessing media devices.", error);
        });
    } else if (role === "doctor") {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: true })
        .then((currentStream) => {
          setStream(currentStream);
          myVideo.current.srcObject = currentStream;
  
          // Fetch predictions from backend
          const fetchPredictions = async () => {
            try {
              const response = await axios.get('https://videocall-fa7g.onrender.com/api/predictions');
              setTranscript(response.data.map((p) => p.text));
            } catch (error) {
              console.error("Error fetching predictions:", error);
            }
          };
  
          // Fetch predictions initially
          fetchPredictions();
  
          // Set an interval to fetch predictions every 500ms
          const intervalId = setInterval(() => {
            fetchPredictions();
          }, 500);
  
          // Event listener for storage change, which could include new predictions
          const handleStorageChange = (event) => {
            if (event.key === "predictions") {
              fetchPredictions();
            }
          };
  
          window.addEventListener("storage", handleStorageChange);
  
          // Cleanup the interval and event listener when the component unmounts or role changes
          return () => {
            clearInterval(intervalId);
            window.removeEventListener("storage", handleStorageChange);
          };
        })
        .catch((error) => {
          console.error("Error accessing media devices.", error);
        });
    }
  }, [role]);
  // Handle storage changes to update transcript in real-time
  const handleStorageChange = (event) => {
    if (event.key === "predictions") {
      const updatedPredictions = JSON.parse(event.newValue) || [];
      setTranscript(updatedPredictions);
    }
  };

  // Make prediction and store in localStorage
  const makePrediction = async (landmarks) => {
    if (modelRef.current) {
      const image = new Float32Array(224 * 224 * 3).fill(0);
  
      landmarks.forEach((l) => {
        const x = Math.floor(l.x * 224);
        const y = Math.floor(l.y * 224);
        if (x < 224 && y < 224) {
          const pos = (y * 224 + x) * 3;
          image[pos] = l.x;
          image[pos + 1] = l.y;
          image[pos + 2] = l.z;
        }
      });
  
      const tensorInput = tf.tensor4d(image, [1, 224, 224, 3]);
  
      try {
        const prediction = await modelRef.current.predict(tensorInput);
        const predictionArray = await prediction.array();
        const predictionText = predictionToText(predictionArray);
  
        console.log("Patient-side prediction:", predictionText);
  
        // Send prediction to backend
        await axios.post('https://videocall-fa7g.onrender.com/api/predictions', { text: predictionText });
  
        // Store prediction in localStorage (optional)
        const existingPredictions = JSON.parse(localStorage.getItem("predictions")) || [];
        const updatedPredictions = [...existingPredictions, predictionText];
        localStorage.setItem("predictions", JSON.stringify(updatedPredictions));
  
        // If in doctor role, update transcript immediately
        if (role === "doctor") {
          setTranscript(updatedPredictions);
        }
      } catch (error) {
        console.error("Error during prediction:", error);
      }
    }
  };

  // Convert prediction array to text
  const predictionToText = (predictionArray) => {
    const output = predictionArray[0];
    const maxIndex = output.indexOf(Math.max(...output));
    const classNames = ["Label_1", "Label_2"]; 
    return classNames[maxIndex];
  };
  

  // Draw hand landmarks on canvas
  const drawHand = (canvasCtx, landmarks, connections) => {
    for (let i = 0; i < connections.length; i++) {
      const start = landmarks[connections[i][0]];
      const end = landmarks[connections[i][1]];
      canvasCtx.beginPath();
      canvasCtx.moveTo(start.x * canvasCtx.canvas.width, start.y * canvasCtx.canvas.height);
      canvasCtx.lineTo(end.x * canvasCtx.canvas.width, end.y * canvasCtx.canvas.height);
      canvasCtx.strokeStyle = "#00FF00";
      canvasCtx.lineWidth = 5;
      canvasCtx.stroke();
    }

    for (let i = 0; i < landmarks.length; i++) {
      const x = landmarks[i].x * canvasCtx.canvas.width;
      const y = landmarks[i].y * canvasCtx.canvas.height;
      canvasCtx.beginPath();
      canvasCtx.arc(x, y, 5, 0, 2 * Math.PI);
      canvasCtx.fillStyle = "#FF0000";
      canvasCtx.fill();
    }
  };

  // Initiate a call to another user
  const callUser = (id) => {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream: stream,
    });

    peer.on("signal", (data) => {
      socket.emit("callUser", {
        userToCall: id,
        signalData: data,
        from: me,
        name: name,
      });
    });

    peer.on("stream", (currentStream) => {
      userVideo.current.srcObject = currentStream;
    });

    socket.on("callAccepted", (signal) => {
      setCallAccepted(true);
      peer.signal(signal);
    });

    connectionRef.current = peer;
  };

  // Answer an incoming call
  const answerCall = () => {
    setCallAccepted(true);
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream: stream,
    });

    peer.on("signal", (data) => {
      socket.emit("answerCall", { signal: data, to: caller });
    });

    peer.on("stream", (currentStream) => {
      userVideo.current.srcObject = currentStream;
    });

    peer.signal(callerSignal);
    connectionRef.current = peer;
  };
  const leaveCall = async () => {
    setCallEnded(true);
    connectionRef.current.destroy();
  
    try {
      // Send a delete request to the backend to remove all predictions
      await axios.delete('https://videocall-fa7g.onrender.com/api/predictions');
      console.log("All predictions deleted successfully");
    } catch (error) {
      console.error("Error deleting predictions:", error);
    }
  
    window.location.reload();
  };

  return (
    <>
      <h1 style={{ textAlign: "center" }}>VIDEO CALL INTERFACE</h1>
      <div className="container">
        {/* Role Selection */}
        <div className="role-selector">
          {!role && (
            <>
              <Button variant="contained" color="primary" onClick={() => setRole("patient")}>
                Join as Patient
              </Button>
              <Button variant="contained" color="secondary" onClick={() => setRole("doctor")}>
                Join as Doctor
              </Button>
            </>
          )}
        </div>
  
        {/* Video Streams */}
        <div className="video-container">
          <div className="video">
            {stream && (
              <>
                <video
                  playsInline
                  muted
                  ref={myVideo}
                  autoPlay
                  style={{ width: "300px", display: role === "patient" ? "none" : "block" }}
                />
                {role === "patient" && (
                  <canvas
                    ref={canvasRef}
                    style={{ position: "absolute", width: "300px", height: "auto" }}
                  />
                )}
              </>
            )}
          </div>
          <div className="video">
            {callAccepted && !callEnded ? (
              <video playsInline ref={userVideo} autoPlay style={{ width: "300px" }} />
            ) : null}
          </div>
        </div>
  
        {/* User ID and Call Controls */}
        <div className="myId">
          <TextField
            id="filled-basic"
            label="Name"
            variant="filled"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginBottom: "20px" }}
          />
          <CopyToClipboard text={me} style={{ marginBottom: "2rem" }}>
            <Button variant="contained" color="primary" startIcon={<AssignmentIcon />}>
              Copy ID
            </Button>
          </CopyToClipboard>
  
          <TextField
            id="filled-basic"
            label="ID to call"
            variant="filled"
            value={idToCall}
            onChange={(e) => setIdToCall(e.target.value)}
          />
          <div className="call-button">
            {callAccepted && !callEnded ? (
              <>
                <Button variant="contained" color="secondary" onClick={leaveCall}>
                  End Call
                </Button>
                <Button variant="contained" color="secondary" onClick={leaveCall} style={{ marginLeft: "10px" }}>
                  Leave Call
                </Button>
              </>
            ) : (
              <IconButton color="primary" aria-label="call" onClick={() => callUser(idToCall)}>
                <PhoneIcon fontSize="large" />
              </IconButton>
            )}
          </div>
        </div>
  
        {/* Incoming Call Notification */}
        {receivingCall && !callAccepted && (
          <div className="caller">
            <h1>{name} is calling...</h1>
            <Button variant="contained" color="primary" onClick={answerCall}>
              Answer
            </Button>
          </div>
        )}
  
        {/* Transcript for Doctor */}
        {role === "doctor" && (
          <div className="transcript-container">
            <h2>Transcript:</h2>
            {transcript.length > 0 ? (
              <textarea readOnly value={transcript.join(" ")} />
            ) : (
              <p>No predictions available.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default App;