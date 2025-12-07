#!/bin/bash

# Quick test script for the handle finder API
# Make sure your backend is running on port 3000

echo "🔍 Testing Twitter Handle Finder API"
echo "===================================="
echo ""

# Test 1: MKBHD
echo "Test 1: Finding handle for MKBHD..."
curl -s -X POST http://localhost:3000/api/debate/find-handle \
  -H "Content-Type: application/json" \
  -d '{"name": "MKBHD"}' | jq '.'
echo ""

# Test 2: Elon Musk
echo "Test 2: Finding handle for Elon Musk..."
curl -s -X POST http://localhost:3000/api/debate/find-handle \
  -H "Content-Type: application/json" \
  -d '{"name": "Elon Musk"}' | jq '.'
echo ""

# Test 3: Random/Unknown person
echo "Test 3: Finding handle for unknown person..."
curl -s -X POST http://localhost:3000/api/debate/find-handle \
  -H "Content-Type: application/json" \
  -d '{"name": "Random Unknown Person"}' | jq '.'
echo ""

echo "✅ Tests complete!"
echo ""
echo "Note: If you see connection errors, make sure:"
echo "1. Backend server is running (npm start in backend/)"
echo "2. Port 3000 is available"
echo "3. GROK_API_KEY is set in backend/.env"

