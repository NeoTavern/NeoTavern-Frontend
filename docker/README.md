# NeoTavern Frontend - Docker Support

> [!WARNING]  
> This is not working yet. Do not read/follow this guide.

This directory contains the necessary files to run NeoTavern Frontend using Docker.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine.
- [SillyTavern](https://github.com/SillyTavern/SillyTavern) running on your host machine (Port 8000).
- [NeoTavern-Server-Plugin](https://github.com/NeoTavern/NeoTavern-Server-Plugin) installed in SillyTavern.

## Usage

1. **Start the Container**
   Navigate to this folder and run:

   ```bash
   docker compose up -d --build
   ```

2. **Open the App**
   Go to: `http://localhost:8787`

The container automatically creates a bridge so the application can talk to your locally running SillyTavern instance, regardless of whether you are on Windows, Mac, or Linux.

## Configuration

If your SillyTavern Backend is NOT running on port 8000, edit `docker-compose.yml`:

```yaml
environment:
  - BACKEND_PORT=9000 # Set to your actual ST port
```

## Updating

To update to the latest version:

```bash
git pull
cd docker
docker compose up -d --build
```
