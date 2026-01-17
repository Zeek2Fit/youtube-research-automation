#!/bin/bash
# TubeAutomator Local Setup Script
# Run this script to install system dependencies for local development

set -e

echo "🚀 TubeAutomator - Local Setup Script"
echo "======================================"

# Detect OS
OS="$(uname -s)"
echo "📍 Detected OS: $OS"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install yt-dlp
install_ytdlp() {
    echo ""
    echo "📦 Installing yt-dlp..."
    
    if command_exists yt-dlp; then
        echo "✅ yt-dlp is already installed: $(yt-dlp --version)"
        return 0
    fi
    
    case "$OS" in
        Darwin)
            if command_exists brew; then
                brew install yt-dlp
            else
                echo "⚠️  Homebrew not found. Installing via pip..."
                pip3 install yt-dlp
            fi
            ;;
        Linux)
            if command_exists apt-get; then
                sudo apt-get update && sudo apt-get install -y yt-dlp
            elif command_exists yum; then
                sudo yum install -y yt-dlp
            elif command_exists pip3; then
                pip3 install yt-dlp
            else
                echo "⚠️  Could not detect package manager. Please install yt-dlp manually."
                echo "   Visit: https://github.com/yt-dlp/yt-dlp#installation"
                return 1
            fi
            ;;
        *)
            echo "⚠️  Unknown OS. Please install yt-dlp manually."
            echo "   Visit: https://github.com/yt-dlp/yt-dlp#installation"
            return 1
            ;;
    esac
    
    if command_exists yt-dlp; then
        echo "✅ yt-dlp installed successfully: $(yt-dlp --version)"
    fi
}

# Install ffmpeg (required by yt-dlp for audio extraction)
install_ffmpeg() {
    echo ""
    echo "📦 Installing ffmpeg..."
    
    if command_exists ffmpeg; then
        echo "✅ ffmpeg is already installed"
        return 0
    fi
    
    case "$OS" in
        Darwin)
            if command_exists brew; then
                brew install ffmpeg
            else
                echo "⚠️  Please install Homebrew first, then run: brew install ffmpeg"
                return 1
            fi
            ;;
        Linux)
            if command_exists apt-get; then
                sudo apt-get update && sudo apt-get install -y ffmpeg
            elif command_exists yum; then
                sudo yum install -y ffmpeg
            else
                echo "⚠️  Could not detect package manager. Please install ffmpeg manually."
                return 1
            fi
            ;;
        *)
            echo "⚠️  Unknown OS. Please install ffmpeg manually."
            return 1
            ;;
    esac
    
    if command_exists ffmpeg; then
        echo "✅ ffmpeg installed successfully"
    fi
}

# Install Node.js dependencies
install_node_deps() {
    echo ""
    echo "📦 Installing Node.js dependencies..."
    
    if [ -f "package.json" ]; then
        npm install
        echo "✅ Node.js dependencies installed"
    else
        echo "⚠️  package.json not found. Please run this script from the project root."
        return 1
    fi
}

# Setup environment file
setup_env() {
    echo ""
    echo "📝 Setting up environment..."
    
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
            echo "✅ Created .env from .env.example"
        else
            cat > .env << 'EOF'
# Database connection (PostgreSQL)
DATABASE_URL=postgresql://username:password@localhost:5432/tubeautomator

# OpenAI API Key (required for Whisper transcription)
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Custom Chromium path (leave empty to use Puppeteer's bundled version)
# PUPPETEER_EXECUTABLE_PATH=/path/to/chromium
# CHROMIUM_PATH=/path/to/chromium
EOF
            echo "✅ Created .env template"
        fi
        echo "⚠️  Please edit .env and add your API keys"
    else
        echo "✅ .env file already exists"
    fi
}

# Run all setup steps
main() {
    install_ytdlp
    install_ffmpeg
    install_node_deps
    setup_env
    
    echo ""
    echo "======================================"
    echo "✅ Setup complete!"
    echo ""
    echo "Next steps:"
    echo "1. Edit .env and add your OPENAI_API_KEY"
    echo "2. Configure DATABASE_URL for your PostgreSQL database"
    echo "3. Run 'npm run dev' or 'npx mastra dev' to start the server"
    echo ""
    echo "For more information, see README.md"
}

main
