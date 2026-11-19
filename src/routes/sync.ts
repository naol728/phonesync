import express from "express";
import { syncCall, syncSms } from "../controller/sync.controller.js";
const syncRouter = express.Router();
syncRouter.post("/sms", syncSms);
syncRouter.post("/calls", syncCall);
export default syncRouter;
