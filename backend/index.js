import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import debateAnalyzerRoutes from './routes/debate-analyzer.js';
import claimSourcesRoutes from './routes/claim-sources.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Veritas API is running' });
});

// Mount debate analyzer routes
app.use('/api/debate', debateAnalyzerRoutes);
app.use('/api/claims', claimSourcesRoutes);

app.listen(PORT, () => {
    console.log(`🚀 Veritas API running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});
