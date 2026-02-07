import express from "express";

const router = express.Router();

router.get("/status", (_req, res) => {
  res.json({ api: "ok" });
});

export default router;
