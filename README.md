# Virtual Retail Assistant Queue - Producer-Consumer Simulator

OS practical: bounded-buffer Producer-Consumer problem with `empty`, `full` and `mutex`.

| Concept | Mapping |
|---|---|
| Producer | Customers |
| Buffer (capacity 5) | Query Queue (FIFO) |
| Consumer | AI Processing Server |
| `empty` | free buffer slots |
| `full` | queries waiting |
| `mutex` | protects the shared queue |
| `in` / `out` | insert / remove positions (mod 5) |

## Run in VS Code
1. File > Open Folder... and choose `retail-queue-simulator`.
2. Install the **Live Server** extension, right-click `index.html` > **Open with Live Server**.
   (Or just double-click `index.html` - no build step or dependencies needed.)

## Files
- `index.html` - page layout
- `style.css` - styling
- `script.js` - semaphore logic (Sem class), producer(), consumer(), UI rendering

## Usage
Choose 1-5 customers, type a different query for each, then Start. Use Pause / Resume / Reset as needed.
