# Flappy Horizon

A beautiful, volumetric 3D nature-themed Flappy Bird clone with camera-based hand gesture controls and a shared global leaderboard.

---

## How to Deploy to Render.com (Free)

You can host this application on **Render.com** for free so that anyone on the internet can play it and submit their high scores!

### Step 1: Put your code on GitHub

1. Create a new repository on [GitHub](https://github.com).
2. Push all the files in this directory (including `.gitignore`, `server.py`, `index.html`, etc.) to your GitHub repository.

### Step 2: Create a Web Service on Render

1. Create a free account on [Render.com](https://render.com).
2. Click **New** (top right) and select **Web Service**.
3. Connect your GitHub account and select your repository.
4. Configure the Web Service settings:
   - **Name**: `flappy-horizon` (or any name you prefer)
   - **Language**: `Python`
   - **Branch**: `main` (or whatever branch you pushed to)
   - **Build Command**: (Leave it blank, as there are no dependencies to install)
   - **Start Command**: `python server.py`
   - **Instance Type**: `Free`

### Step 3: Add a Persistent Disk (Crucial for Leaderboard)

Since the Render free tier is ephemeral (restarts erase files), we can attach a free persistent disk so your global leaderboard scores are saved permanently!

1. Scroll down to the **Advanced** section of your Web Service configuration, or go to the **Disks** tab in your service dashboard after creation.
2. Click **Add Disk** / **New Disk**:
   - **Name**: `leaderboard-data`
   - **Mount Path**: `/data`
   - **Size**: `1 GiB` (Free Tier maximum)
3. Save changes. Render will automatically mount the disk at `/data` inside the container, matching the `data/leaderboard.json` configuration in the server code.

### Step 4: Deploy and Play!

1. Click **Deploy Web Service**.
2. Once the build finishes and the log shows `Server successfully started`, copy your public Render URL (e.g. `https://flappy-horizon.onrender.com`).
3. Share the link with your friends so they can fly and compete on the shared leaderboard!
