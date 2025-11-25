<h1 align="center">SillyTavern Experimental Frontend</h1>

<p align="center">
  A modern, experimental frontend for SillyTavern, built with Vue 3 and Vite.
</p>

## Getting Started

### Prerequisites

- Node.js (v20 or higher recommended)
- pnpm (or your package manager of choice)
- A running instance of the SillyTavern backend server.

### Development

1.  **Clone the repository:**

    ```bash
    https://github.com/bmen25124/SillyTavern-Experimental-Frontend.git
    cd SillyTavern-Experimental-Frontend
    ```

2.  **Install dependencies:**

    ```bash
    pnpm install
    ```

3.  **Run the development server:**
    ```bash
    pnpm dev
    ```
    This will start the Vite development server. By default, it proxies API requests to `http://localhost:8000`, which is the standard SillyTavern backend address. You can configure the proxy in `vite.config.ts`.
