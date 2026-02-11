import dotenv from "dotenv";
import express from "express";
import path from "path";
import bodyParser from "body-parser";
import morgan from "morgan";
import webhooksRouter from "./routes/webhooks";
import apiRouter from "./routes/api";
import adminRouter from "./routes/admin";
import maintenanceRouter from "./routes/maintenance";
import maintenanceListRouter from "./routes/maintenance-list";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan("dev"));

app.use(express.static(path.join(process.cwd(), "public")));

// Serve dashboard at /dashboard for convenience
app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "dashboard.html"));
});

app.use("/webhooks", webhooksRouter);
app.use("/api", apiRouter);
app.use("/admin", adminRouter);
// Register list endpoint before the catch-all /maintenance router so it is reachable.
app.use("/maintenance/list", maintenanceListRouter);
app.use("/maintenance", maintenanceRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Landlord Stress Firewall listening on port ${port}`);
});
