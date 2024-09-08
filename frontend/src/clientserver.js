const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 5127;
const MONGO_URI = 'mongodb+srv://namansrivastava1608:tmUdjxBmfuziAqLb@cluster0.rtdhv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'; // Replace with your MongoDB Atlas connection string

// Connect to MongoDB
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Connected to MongoDB Atlas');
}).catch(err => {
  console.error('Error connecting to MongoDB:', err);
});

// Create a Schema and Model
const predictionSchema = new mongoose.Schema({
  text: String,
  timestamp: { type: Date, default: Date.now },
});

const Prediction = mongoose.model('Prediction', predictionSchema);

// Routes
app.post('/api/predictions', async (req, res) => {
  try {
    const { text } = req.body;
    const newPrediction = new Prediction({ text });
    await newPrediction.save();
    res.status(201).json(newPrediction);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/predictions', async (req, res) => {
  try {
    const predictions = await Prediction.find().sort({ timestamp: -1 });
    res.status(200).json(predictions);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.delete('/api/predictions', async (req, res) => {
  try {
    await Prediction.deleteMany({});
    res.status(200).send('All predictions deleted successfully');
  } catch (error) {
    res.status(500).send('Error deleting predictions: ' + error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
