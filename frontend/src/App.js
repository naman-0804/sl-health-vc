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
            modelRef.current = await tf.loadLayersModel("/model.json");
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
            // Convert landmarks to a 2D tensor format
            // landmarks is an array of objects with x, y, z properties
            const input = landmarks.map(l => [l.x, l.y, l.z]);
    
            // Check dimensions
            console.log("Input shape:", [1, input.length, 3]);
    
            // Create a tensor with shape [1, landmarks.length, 3]
            const tensorInput = tf.tensor2d(input, [1, input.length, 3]);
    
            // Make the prediction
            const prediction = await modelRef.current.predict(tensorInput).data();
            const predictionText = predictionToText(tf.tensor(prediction)); // Convert prediction to text
    
            // Send the prediction to the doctor via WebSocket
            socket.emit("prediction", predictionText);
        }
    };

    const predictionToText = (prediction) => {
        const output = prediction.dataSync();
        const maxIndex = output.indexOf(Math.max(...output));
        const classNames = ["Gesture1", "Gesture2", "Gesture3"];
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
