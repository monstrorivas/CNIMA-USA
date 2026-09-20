# CNIMA USA Website

[![Netlify Status](https://api.netlify.com/api/v1/badges/f7a150d8-35d6-4ae5-8b23-ab364af88379/deploy-status)](https://app.netlify.com/projects/gilded-crostata-bfc852/deploys)

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

### Editing the Registration Form

**Note:** The root `index.html` is currently the 2027 teaser page and has no live registration form — registration hasn't opened for the next workshop yet. `components/register.html` (root-level) still holds the last working form as a template for when it does.

Once a real registration form is wired back into `index.html`, the same split applies as before:
- **Visible form**: `components/register.html` - Edit this file to make changes
- **Hidden form**: `index.html` - Auto-generated, do not edit manually

**How it works:**
- When you edit `components/register.html`, the hidden form in `index.html` is automatically generated during Netlify builds
- The build script (`scripts/generate-hidden-form.js`) extracts all form fields and creates the hidden form
- If `index.html` has no hidden-form placeholder (or `components/register.html` doesn't exist), the script logs a message and skips instead of failing the build - this is the current state for the 2027 teaser
- **You only need to edit `components/register.html`** - the rest is handled automatically

**For local testing** (optional):
```bash
# If you want to test the form generation locally before deploying
node scripts/generate-hidden-form.js
```

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
cd /Users/albertorivas/Projects/git/github/CNIMA-USA

# Start the server
python3 -m http.server 8000

# Open your browser and visit:
# http://localhost:8000
```

**Option 2: Node.js http-server**
```bash
# Navigate to the project directory
cd /Users/albertorivas/Projects/git/github/CNIMA-USA

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
├── index.html              # Current homepage: the 2027 "coming soon" teaser
├── styles-2027.css         # Styling for the teaser and the archive hub
├── netlify.toml            # Netlify configuration
├── success.html            # Registration success page (Netlify form redirect)
├── mailing-list-success.html  # Mailing-list signup success page
├── archive/
│   ├── index.html          # Archive hub - lists every past workshop year
│   └── 2026/                # Frozen snapshot of the 2026 workshop site
│       ├── index.html
│       ├── styles.css
│       ├── script.js
│       └── components/      # Same component pattern as below, content frozen
├── components/              # Dormant template for the next full year build-out
│   ├── register.html       # Last working registration form (not currently live)
│   └── ...
├── scripts/                 # Build scripts
│   └── generate-hidden-form.js  # Auto-generates hidden form for Netlify (skips if no active form)
└── README.md                # This file
```

Each past workshop year gets its own folder under `archive/`, following the same pattern as `archive/2026/`: a full copy of that year's site with registration closed, the mailing-list signup removed, and payment QR codes stripped, plus a card added to `archive/index.html`. When the next year's registration is ready to go live, root `index.html`, `components/`, and `script.js` are the starting template.

## Notes

- The mailing-list form on the teaser uses Netlify Forms which requires no backend code
- All form submissions will be available in your Netlify dashboard
- The site is fully responsive and works on all devices
- **Form editing**: Only edit `components/register.html` - the hidden form in `index.html` is auto-generated during builds, once a registration form is live again
- Update the workshop dates and details in the component files as needed
