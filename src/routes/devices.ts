import express from "express";
import {
  deviceStatus,
  registerDevice,
} from "../controller/devices.controller.js";

const devicesRouter = express.Router();
devicesRouter.post("/register", registerDevice);
devicesRouter.get("/status", deviceStatus);

export default devicesRouter;
