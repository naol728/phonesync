import express from "express";
import helmet from "helmet";
import cors from "cors";
import devicesRouter from "./routes/devices.js";
import syncRouter from "./routes/sync.js";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: "*",
  }),
);

app.use(express.json({ limit: "20mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "phonesync-api",
  });
});

// Device registration and status
app.use("/api/devices", devicesRouter);

// Synchronization operations
app.use("/api/sync", syncRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
  });
});

export default app;
