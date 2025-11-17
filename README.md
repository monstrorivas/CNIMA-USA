# CNIMA USA Website

Modern website for CNIMA USA accordion workshops in New Orleans.

## Features

- Modern, responsive design
- Registration form with Netlify Forms integration
- Event promotion and information
- Easy deployment to Netlify

## Deployment to Netlify

### Option 1: Deploy via Netlify UI

1. Go to [Netlify](https://app.netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Connect your GitHub repository
4. Netlify will automatically detect the settings from `netlify.toml`
5. Click "Deploy site"

### Option 2: Deploy via Netlify CLI

```bash
# Install Netlify CLI (if not already installed)
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy
netlify deploy --prod
```

### Option 3: Drag and Drop

1. Go to [Netlify Drop](https://app.netlify.com/drop)
2. Drag and drop the entire project folder
3. Your site will be live in seconds!

## Form Configuration

The registration form uses Netlify Forms. After deployment:

1. Go to your Netlify site dashboard
2. Navigate to "Forms" in the sidebar
3. You'll see all form submissions there
4. You can set up email notifications in Site settings → Forms → Form notifications

## Custom Domain

To connect your custom domain (cnimausa.com):

1. In Netlify dashboard, go to Site settings → Domain management
2. Click "Add custom domain"
3. Enter `cnimausa.com`
4. Follow the DNS configuration instructions

## Local Development

### Quick Start (Recommended)

**Option 1: Python (Built-in on macOS)**
```bash
# Navigate to the project directory
cd /Users/albertorivas/personal/git/github/CNIMA-USA

# Start the server
python3 -m http.server 8000

# Open your browser and visit:
# http://localhost:8000
```

**Option 2: Node.js http-server**
```bash
# Navigate to the project directory
cd /Users/albertorivas/personal/git/github/CNIMA-USA

# Start the server (no installation needed)
npx http-server -p 8000

# Open your browser and visit:
# http://localhost:8000
```

**Option 3: VS Code Live Server Extension**
1. Install the "Live Server" extension in VS Code
2. Right-click on `index.html`
3. Select "Open with Live Server"

### Stopping the Server

**If you started the server in a terminal window:**
- Press `Ctrl+C` in that terminal window

**If you can't find the terminal or the server is running in the background:**
```bash
# Find and kill the process on port 8000
lsof -ti:8000 | xargs kill -9

# Or manually find and kill:
# 1. Find the process ID
lsof -ti:8000

# 2. Kill it (replace PID with the number you see)
kill -9 PID
```

### Important Notes for Local Testing

- **Netlify Forms won't work locally** - The form will display and validate, but submissions won't be processed until deployed to Netlify
- **Test responsiveness**: Use browser dev tools (F12) to test mobile views

## File Structure

```
├── index.html          # Main HTML file
├── styles.css          # All styling
├── script.js           # JavaScript functionality
├── netlify.toml        # Netlify configuration
└── README.md           # This file
```

## Notes

- The form uses Netlify Forms which requires no backend code
- All form submissions will be available in your Netlify dashboard
- The site is fully responsive and works on all devices
- Update the workshop dates and details in `index.html` as needed
