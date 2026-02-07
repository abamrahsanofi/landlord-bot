import express from "express";
import { z } from "zod";
import repo from "../services/repository";
import { MaintenanceStatus } from "@prisma/client";

const router = express.Router();

const tenantSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "name required"),
  phone: z.string().optional(),
  email: z.string().optional(),
});

const unitSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1, "label required"),
  address: z.string().min(1, "address required"),
});

router.post("/tenants", async (req, res) => {
  const parsed = tenantSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  }
  const tenant = await repo.createTenant(parsed.data);
  res.json({ tenant });
});

router.get("/tenants", async (_req, res) => {
  const tenants = await repo.listTenants();
  res.json({ items: tenants });
});

router.post("/units", async (req, res) => {
  const parsed = unitSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  }
  const unit = await repo.createUnit(parsed.data);
  res.json({ unit });
});

router.get("/units", async (_req, res) => {
  const units = await repo.listUnits();
  res.json({ items: units });
});

const statusSchema = z.object({
  status: z.nativeEnum(MaintenanceStatus),
});

router.patch("/maintenance/:id/status", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  }
  const updated = await repo.updateMaintenanceStatus({ id: req.params.id, status: parsed.data.status });
  if (!updated) return res.status(404).json({ error: "not_found" });
  res.json({ maintenance: updated });
});

export default router;
