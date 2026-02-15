// Function to set the risk score
function setRiskScore(score, domain = 'example.com') {
    // Update the score number
    document.getElementById('scoreNumber').textContent = score;
    
    // Update domain
    document.querySelector('.domain').textContent = domain;
    
    // Calculate the circumference of the circle (radius = 90)
    const radius = 90;
    const circumference = 2 * Math.PI * radius;
    
    // Calculate the percentage and dash offset
    const percentage = Math.min(score, 100) / 100;
    const offset = circumference - (circumference * percentage);
    
    // Update the circle
    const circle = document.getElementById('progressCircle');
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = offset;
    
    // Optional: Change color based on risk level
    if (score >= 75) {
        circle.style.stroke = '#ef4444'; // Red - High Risk
    } else if (score >= 50) {
        circle.style.stroke = '#f97316'; // Orange - Medium Risk
    } else if (score >= 25) {
        circle.style.stroke = '#eab308'; // Yellow - Low Risk
    } else {
        circle.style.stroke = '#22c55e'; // Green - Very Low Risk
    }
}

// Function to update all indicators
function updateIndicators(data) {
    // Update phishing indicator
    const phishingScore = data.phishing || 0;
    document.getElementById('phishingScore').textContent = phishingScore + '%';

    // Update AI generated content indicator
    const aiScore = data.aiGenerated || 0;
    document.getElementById('aiScore').textContent = aiScore + '%';

    // Update deepfake indicator
    const deepfakeScore = data.deepfake || 0;
    document.getElementById('deepfakeScore').textContent = deepfakeScore + '%';
}

// Initialize with score 73
document.addEventListener('DOMContentLoaded', function() {
    setRiskScore(73, 'example.com');
});

// Example: You can call this to update the score
// setRiskScore(45, 'google.com');