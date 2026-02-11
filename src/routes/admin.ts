import express from "express";
import { z } from "zod";
import repo from "../services/repository";
import { MaintenanceStatus, UtilityType } from "@prisma/client";
import whatsappService from "../services/whatsappService";

const router = express.Router();

const tenantSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "name required"),
  phone: z.string().optional(),
  email: z.string().optional(),
  unitId: z.string().optional(),
});

const tenantUpdateSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  unitId: z.string().nullable().optional(),
});

const contractorSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "name required"),
  phone: z.string().min(5, "phone required"),
  email: z.string().optional(),
  role: z.string().optional(),
});

const contractorUpdateSchema = contractorSchema.partial();

const unitSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1, "label required"),
  address: z.string().min(1, "address required"),
});

const unitUpdateSchema = unitSchema.partial().omit({ id: true }).extend({
  label: z.string().optional(),
  address: z.string().optional(),
});

const tenantContactSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
}).refine((data) => Boolean(data.phone || data.email), {
  message: "phone or email required",
});

const whatsappTestSchema = z.object({
  to: z.string().min(5, "destination required"),
  message: z.string().min(1, "message required"),
  session: z.string().optional(),
});

const utilityCredentialSchema = z.object({
  unitId: z.string().min(1, "unit required"),
  utilityType: z.enum(["INTERNET", "WATER_GAS", "HYDRO"]),
  username: z.string().optional(),
  password: z.string().optional(),
  notes: z.string().optional(),
});

const utilityCredentialUpdateSchema = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
  notes: z.string().optional(),
});

const utilityBillSchema = z.object({
  unitId: z.string().optional(),
  tenantId: z.string().optional(),
  maintenanceId: z.string().optional(),
  utilityType: z.nativeEnum(UtilityType),
  amountCents: z.number().min(0),
  currency: z.string().optional(),
  billingPeriodStart: z.string().optional(),
  billingPeriodEnd: z.string().optional(),
  statementUrl: z.string().optional(),
  portalUsername: z.string().optional(),
  anomalyFlag: z.boolean().optional(),
  anomalyNotes: z.string().optional(),
  rawData: z.any().optional(),
});

const utilityBillUpdateSchema = utilityBillSchema.partial().omit({ utilityType: true }).extend({ amountCents: z.number().optional() });

type Reminder = {
  id: string;
  type: "rent" | "utility";
  dayOfMonth: number;
  timeUtc: string;
  style: "short" | "medium" | "professional" | "casual";
};

const reminders: Reminder[] = [];

router.post("/tenants", async (req, res) => {
  const parsed = tenantSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  }
  const tenant = await repo.createTenant(parsed.data);
  res.json({ tenant });
});

router.patch("/tenants/:id", async (req, res) => {
  const parsed = tenantUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  const updated = await repo.updateTenant({ id: req.params.id, ...parsed.data });
  if (!updated) return res.status(404).json({ error: "not_found" });
  res.json({ tenant: updated });
});

router.delete("/tenants/:id", async (req, res) => {
  const deleted = await repo.deleteTenant({ id: req.params.id, hard: req.query?.hard === "true" });
  if (!deleted) return res.status(404).json({ error: "not_found" });
  res.json({ deleted: true });
});

router.post("/contractors", async (req, res) => {
  const parsed = contractorSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  }
  const contractor = await repo.createContractor(parsed.data);
  res.json({ contractor });
});

router.patch("/contractors/:id", async (req, res) => {
  const parsed = contractorUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  const contractor = await repo.updateContractor({ id: req.params.id, ...parsed.data });
  if (!contractor) return res.status(404).json({ error: "not_found" });
  res.json({ contractor });
});

router.delete("/contractors/:id", async (req, res) => {
  const contractor = await repo.deleteContractor({ id: req.params.id, hard: req.query?.hard === "true" });
  if (!contractor) return res.status(404).json({ error: "not_found" });
  res.json({ deleted: true });
});

router.patch("/tenants/:id/contact", async (req, res) => {
  const parsed = tenantContactSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  }
  const updated = await repo.updateTenantContact({ id: req.params.id, ...parsed.data });
  if (!updated) return res.status(404).json({ error: "not_found" });
  res.json({ tenant: updated });
});

router.get("/tenants", async (_req, res) => {
  const tenants = await repo.listTenants();
  res.json({ items: tenants });
});

router.get("/contractors", async (_req, res) => {
  const contractors = await repo.listContractors();
  res.json({ items: contractors });
});

router.post("/units", async (req, res) => {
  const parsed = unitSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  }
  const unit = await repo.createUnit(parsed.data);
  res.json({ unit });
});

router.patch("/units/:id", async (req, res) => {
  const parsed = unitUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  const unit = await repo.updateUnit({ id: req.params.id, ...parsed.data });
  if (!unit) return res.status(404).json({ error: "not_found" });
  res.json({ unit });
});

router.delete("/units/:id", async (req, res) => {
  const unit = await repo.deleteUnit({ id: req.params.id, hard: req.query?.hard === "true" });
  if (!unit) return res.status(404).json({ error: "not_found" });
  res.json({ deleted: true });
});

router.get("/units", async (_req, res) => {
  const units = await repo.listUnits();
  res.json({ items: units });
});

router.post("/utilities/credentials", async (req, res) => {
  const parsed = utilityCredentialSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  }
  const credential = await repo.createUtilityCredential(parsed.data);
  res.json({ credential });
});

router.patch("/utilities/credentials/:id", async (req, res) => {
  const parsed = utilityCredentialUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  const credential = await repo.updateUtilityCredential({ id: req.params.id, ...parsed.data });
  if (!credential) return res.status(404).json({ error: "not_found" });
  res.json({ credential });
});

router.delete("/utilities/credentials/:id", async (req, res) => {
  const credential = await repo.deleteUtilityCredential({ id: req.params.id });
  if (!credential) return res.status(404).json({ error: "not_found" });
  res.json({ deleted: true });
});

router.get("/utilities/credentials", async (req, res) => {
  const unitId = typeof req.query?.unitId === "string" ? req.query.unitId : undefined;
  const utilityType = typeof req.query?.utilityType === "string" ? req.query.utilityType : undefined;
  const items = await repo.listUtilityCredentials({ unitId, utilityType });
  res.json({ items });
});

router.get("/utilities/bills", async (req, res) => {
  const unitId = typeof req.query?.unitId === "string" ? req.query.unitId : undefined;
  const tenantId = typeof req.query?.tenantId === "string" ? req.query.tenantId : undefined;
  const limit = req.query?.limit ? Number(req.query.limit) : undefined;
  const items = await repo.listUtilityBills({ unitId, tenantId, limit });
  res.json({ items });
});

router.post("/utilities/bills", async (req, res) => {
  const parsed = utilityBillSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  const bill = await repo.createUtilityBill({
    ...parsed.data,
    billingPeriodStart: parsed.data.billingPeriodStart ? new Date(parsed.data.billingPeriodStart) : undefined,
    billingPeriodEnd: parsed.data.billingPeriodEnd ? new Date(parsed.data.billingPeriodEnd) : undefined,
  });
  res.json({ bill });
});

router.patch("/utilities/bills/:id", async (req, res) => {
  const parsed = utilityBillUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  const bill = await repo.updateUtilityBill({
    id: req.params.id,
    ...parsed.data,
    billingPeriodStart: parsed.data.billingPeriodStart ? new Date(parsed.data.billingPeriodStart) : undefined,
    billingPeriodEnd: parsed.data.billingPeriodEnd ? new Date(parsed.data.billingPeriodEnd) : undefined,
  });
  if (!bill) return res.status(404).json({ error: "not_found" });
  res.json({ bill });
});

router.delete("/utilities/bills/:id", async (req, res) => {
  const bill = await repo.deleteUtilityBill({ id: req.params.id });
  if (!bill) return res.status(404).json({ error: "not_found" });
  res.json({ deleted: true });
});

router.post("/whatsapp/test", async (req, res) => {
  const parsed = whatsappTestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  }
  const result = await whatsappService.sendWhatsAppText({ to: parsed.data.to, text: parsed.data.message, session: parsed.data.session });
  if (!result.ok) return res.status(400).json({ error: result.error || "send_failed", response: result.response });
  res.json({ ok: true, response: result.response });
});

router.get("/landlord-numbers", (_req, res) => {
  const raw = process.env.LANDLORD_WHATSAPP_NUMBERS || "";
  res.json({ raw, numbers: raw.split(",").map((v: string) => v.trim()).filter(Boolean) });
});

router.post("/landlord-numbers", (req, res) => {
  const raw = typeof req.body?.numbers === "string" ? req.body.numbers : "";
  process.env.LANDLORD_WHATSAPP_NUMBERS = raw;
  res.json({ raw, numbers: raw.split(",").map((v: string) => v.trim()).filter(Boolean) });
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

router.delete("/maintenance/:id", async (req, res) => {
  const deleted = await repo.deleteMaintenance({ id: req.params.id });
  if (!deleted) return res.status(404).json({ error: "not_found" });
  res.json({ deleted: true });
});

router.get("/health", (_req, res) => {
  const whatsappReady = Boolean(process.env.EVOLUTION_API_BASE_URL && process.env.EVOLUTION_API_TOKEN);
  const llmReady = Boolean(process.env.GEMINI_API_KEY);
  const utilityReady = Boolean(process.env.UTILITY_AGENT_URL);
  const jeffyReady = Boolean(process.env.JEFFY_API_URL);
  res.json({
    llm: llmReady ? "connected" : "disconnected",
    whatsapp: whatsappReady ? "connected" : "disconnected",
    utility: utilityReady ? "connected" : "disconnected",
    jeffy: jeffyReady ? "connected" : "disconnected",
  });
});

router.get("/reminders", (_req, res) => {
  res.json({ items: reminders });
});

router.post("/reminders", (req, res) => {
  const schema = z.object({
    type: z.enum(["rent", "utility"]),
    dayOfMonth: z.number().min(1).max(28),
    timeUtc: z.string().min(4),
    style: z.enum(["short", "medium", "professional", "casual"]),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
  const reminder: Reminder = { id: `rem-${Date.now()}`, ...parsed.data } as Reminder;
  reminders.push(reminder);
  res.json({ reminder });
});

router.delete("/reminders/:id", (req, res) => {
  const idx = reminders.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not_found" });
  reminders.splice(idx, 1);
  res.json({ deleted: true });
});

router.post("/utilities/bills/:id/send-whatsapp", async (req, res) => {
  const number = typeof req.body?.to === "string" ? req.body.to : undefined;
  const statementUrl = typeof req.body?.statementUrl === "string" ? req.body.statementUrl : undefined;
  const text = typeof req.body?.message === "string" ? req.body.message : "Utility bill available";
  if (!number) return res.status(400).json({ error: "destination_required" });
  const payloadText = statementUrl ? `${text}\n${statementUrl}` : text;
  const sent = await whatsappService.sendWhatsAppText({ to: number, text: payloadText, session: req.body?.session });
  if (!sent.ok) return res.status(400).json({ error: sent.error || "send_failed", response: sent.response });
  res.json({ ok: true, response: sent.response });
});

export default router;
