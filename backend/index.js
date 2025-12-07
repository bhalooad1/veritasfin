import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import debateAnalyzerRoutes from './routes/debate-analyzer.js';
import claimSourcesRoutes from './routes/claim-sources.js';
import biasAnalyzerRoutes from './routes/bias-analyzer.js';
import grokipediaExporterRoutes from './routes/grokipedia-exporter.js';
import comparativeAnalysisRoutes from './routes/comparative-analysis.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Veritas API is running' });
});

// Mount all routes
app.use('/api/debate', debateAnalyzerRoutes);
app.use('/api/claims', claimSourcesRoutes);
app.use('/api/bias', biasAnalyzerRoutes);
app.use('/api/grokipedia', grokipediaExporterRoutes);
app.use('/api/compare', comparativeAnalysisRoutes);

app.listen(PORT, () => {
    console.log(`🚀 Veritas API running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`\n📋 Available endpoints:`);
    console.log(`   /api/debate - Debate analysis and fact-checking`);
    console.log(`   /api/claims - Source generation and validation`);
    console.log(`   /api/bias - Bias detection and analysis`);
    console.log(`   /api/grokipedia - Grokipedia article generation`);
    console.log(`   /api/compare - Comparative speaker analysis`);
});
