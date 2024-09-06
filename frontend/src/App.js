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
import * as tf from '@tensorflow/tfjs';

const socket = io.connect('https://sl-health.onrender.com');

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

    useEffect(() => {
        const loadModel = async () => {
            try {
                modelRef.current = await tf.loadLayersModel("/model.json");
                console.log("Model loaded successfully");
            } catch (error) {
                console.error("Error loading model:", error);
            }
        };

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

            navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then((stream) => {
                setStream(stream);
                myVideo.current.srcObject = stream;

                const hands = new Hands({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
                });

                hands.setOptions({
                    maxNumHands: 1,
                    modelComplexity: 1,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });

                hands.onResults(onResults);

                const camera = new Camera(myVideo.current, {
                    onFrame: async () => {
                        await hands.send({ image: myVideo.current });
                    },
                    width: 1280,
                    height: 720
                });

                camera.start();
            });
        } else if (role === "doctor") {
            navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
                setStream(stream);
                myVideo.current.srcObject = stream;

                socket.on("prediction", (prediction) => {
                    setTranscript((prev) => [...prev, prediction]);
                });
            });
        }

        socket.on("me", (id) => {
            setMe(id);
        });

        socket.on("callUser", (data) => {
            setReceivingCall(true);
            setCaller(data.from);
            setName(data.name);
            setCallerSignal(data.signal);
        });

        loadModel();
    }, [role]);

    const makePrediction = async (landmarks) => {
        if (modelRef.current) {
            // Convert landmarks into a flat array of shape [21 * 3]
            const input = landmarks.flatMap(l => [l.x, l.y, l.z]);  // Flatten to [63] array

            // Log the flattened input for debugging
            console.log("Flattened input:", input);

            // Create a tensor from the input data
            // Initialize an empty image with zeros
            const image = new Float32Array(224 * 224 * 3).fill(0);

            // Map landmarks into the image (you need to define a mapping strategy)
            // This is a placeholder. You might need to scale or position landmarks correctly.
            landmarks.forEach((l, index) => {
                const x = Math.floor(l.x * 224);  // Assuming landmarks.x are normalized
                const y = Math.floor(l.y * 224);  // Assuming landmarks.y are normalized
                if (x < 224 && y < 224) {
                    const pos = (y * 224 + x) * 3;  // 3 channels
                    image[pos] = l.x;  // Set x value (or any other appropriate transformation)
                    image[pos + 1] = l.y;  // Set y value
                    image[pos + 2] = l.z;  // Set z value
                }
            });

            // Create a 4D tensor [1, 224, 224, 3]
            const tensorInput = tf.tensor4d(image, [1, 224, 224, 3]);

            // Log the tensor shape to ensure it's correct
            console.log("Input tensor shape:", tensorInput.shape);

            try {
                // Make the prediction
                const prediction = await modelRef.current.predict(tensorInput);

                // Convert prediction to array and log
                const predictionArray = await prediction.array();
                console.log("Prediction array:", predictionArray);

                // Convert the prediction to text
                const predictionText = predictionToText(predictionArray);

                // Log the prediction
                console.log("Patient-side prediction:", predictionText);

                // Send the prediction to the doctor via WebSocket
                socket.emit("prediction", predictionText);
            } catch (error) {
                console.error("Error during prediction:", error);
            }
        }
    };

    const predictionToText = (predictionArray) => {
        // Assuming predictionArray is a 2D array [1, numClasses]
        const output = predictionArray[0]; // Extract the first element from the array
        const maxIndex = output.indexOf(Math.max(...output));
        const classNames = ["Hi", "Bye"]; // Replace with actual class names
        return classNames[maxIndex];
    };

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

    const callUser = (id) => {
        const peer = new Peer({
            initiator: true,
            trickle: false,
            stream: stream
        });

        peer.on("signal", (data) => {
            socket.emit("callUser", {
                userToCall: id,
                signalData: data,
                from: me,
                name: name
            });
        });

        peer.on("stream", (stream) => {
            userVideo.current.srcObject = stream;
        });

        socket.on("callAccepted", (signal) => {
            setCallAccepted(true);
            peer.signal(signal);
        });

        connectionRef.current = peer;
    };

    const answerCall = () => {
        setCallAccepted(true);
        const peer = new Peer({
            initiator: false,
            trickle: false,
            stream: stream
        });

        peer.on("signal", (data) => {
            socket.emit("answerCall", { signal: data, to: caller });
        });

        peer.on("stream", (stream) => {
            userVideo.current.srcObject = stream;
        });

        peer.signal(callerSignal);
        connectionRef.current = peer;
    };

    const leaveCall = () => {
        setCallEnded(true);
        connectionRef.current.destroy();
        window.location.reload();
    };

    return (
        <>
            <h1 style={{ textAlign: "center" }}>VIDEO CALL INTERFACE</h1>
            <div className="container">
                <div className="role-selector">
                    <Button onClick={() => setRole("patient")}>Join as Patient</Button>
                    <Button onClick={() => setRole("doctor")}>Join as Doctor</Button>
                </div>

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
                                        style={{ position: "absolute", width: "300px" }} 
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
                        <Button variant="contained" color="primary" startIcon={<AssignmentIcon fontSize="large" />}>
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
                            <Button variant="contained" color="secondary" onClick={leaveCall}>
                                End Call
                            </Button>
                        ) : (
                            <IconButton color="primary" aria-label="call" onClick={() => callUser(idToCall)}>
                                <PhoneIcon fontSize="large" />
                            </IconButton>
                        )}
                    </div>
                </div>
                {receivingCall && !callAccepted ? (
                    <div className="caller">
                        <h1>{name} is calling...</h1>
                        <Button variant="contained" color="primary" onClick={answerCall}>
                            Answer
                        </Button>
                    </div>
                ) : null}
            </div>
            {role === "doctor" && (
                <div className="transcript">
                    <h2>Transcript:</h2>
                    {transcript.map((item, index) => (
                        <p key={index}>{item}</p>
                    ))}
                </div>
            )}
        </>
    );
}

export default App;
