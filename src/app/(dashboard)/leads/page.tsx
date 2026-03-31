"use client";

import { PaginationControls } from "@/components/layout/PaginationControls";
import { usePagination } from "@/hooks/usePagination";
import { useEffect, useState } from "react";

type LeadStage = "LEAD" | "QUALIFIED" | "CONTACTED" | "CONVERTED" | "LOST";
type TreeLeadStage = "" | LeadStage;

interface LeadItem {
  id: string;
  leadStage: LeadStage;
  leadScore: number;
  leadSummary: string | null;
  content: string;
  authorName: string | null;
  authorHandle: string | null;
  receivedAt: string;
  platform: {
    displayName: string;
  };
  cannedResponseTree: {
    name: string;
  } | null;
}

interface CannedTree {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  rootNodeKey: string;
  nodes: unknown;
  matchRules?: unknown;
}

interface TreeOptionDraft {
  label: string;
  nextKey: string;
  containsAny: string[];
}

interface TreeNodeDraft {
  key: string;
  title: string;
  message: string;
  leadStage: TreeLeadStage;
  terminal: boolean;
  defaultNextKey: string;
  options: TreeOptionDraft[];
}

interface TreeMatchRulesDraft {
  includeAny: string[];
  excludeAny: string[];
  websiteUrl: string;
}

interface TreeEditorDraft {
  id: string;
  name: string;
  description: string;
  active: boolean;
  rootNodeKey: string;
  nodes: TreeNodeDraft[];
  matchRules: TreeMatchRulesDraft;
}

interface TreeValidationResult {
  errors: string[];
  nodeIssues: Record<number, string[]>;
}

interface CrmProviderStatus {
  name: string;
  label: string;
  active: boolean;
  connected: boolean;
  mode: "local" | "stub" | "live";
}

interface CrmActivity {
  id: string;
  contactId: string;
  type: "note" | "task";
  title: string | null;
  subject: string | null;
  body: string;
  status: "logged" | "pending" | "completed";
  priority: "low" | "medium" | "high" | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  externalId: string | null;
}

interface ActivityDraft {
  type: "note" | "task";
  title: string;
  subject: string;
  body: string;
  status: "pending" | "completed";
  priority: "low" | "medium" | "high";
  dueAt: string;
}

interface ActivityFilters {
  type: "all" | "note" | "task";
  status: "all" | "logged" | "pending" | "completed";
  query: string;
}

const EMPTY_ACTIVITY_DRAFT: ActivityDraft = {
  type: "note",
  title: "",
  subject: "",
  body: "",
  status: "pending",
  priority: "medium",
  dueAt: "",
};

const EMPTY_ACTIVITY_FILTERS: ActivityFilters = {
  type: "all",
  status: "all",
  query: "",
};

const STAGES: LeadStage[] = ["LEAD", "QUALIFIED", "CONTACTED", "CONVERTED", "LOST"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseLeadStage(value: unknown): TreeLeadStage {
  return typeof value === "string" && STAGES.includes(value as LeadStage)
    ? (value as LeadStage)
    : "";
}

function createEmptyOption(): TreeOptionDraft {
  return {
    label: "",
    nextKey: "",
    containsAny: [],
  };
}

function createEmptyNode(index: number): TreeNodeDraft {
  return {
    key: `node_${index + 1}`,
    title: "",
    message: "",
    leadStage: "",
    terminal: false,
    defaultNextKey: "",
    options: [createEmptyOption()],
  };
}

function parseTreeOption(value: unknown): TreeOptionDraft {
  if (!isRecord(value)) {
    return createEmptyOption();
  }

  return {
    label: typeof value.label === "string" ? value.label : "",
    nextKey: typeof value.nextKey === "string" ? value.nextKey : "",
    containsAny: parseStringArray(value.containsAny),
  };
}

function parseTreeNode(value: unknown, index: number): TreeNodeDraft {
  if (!isRecord(value)) {
    return createEmptyNode(index);
  }

  return {
    key: typeof value.key === "string" ? value.key : `node_${index + 1}`,
    title: typeof value.title === "string" ? value.title : "",
    message: typeof value.message === "string" ? value.message : "",
    leadStage: parseLeadStage(value.leadStage),
    terminal: value.terminal === true,
    defaultNextKey: typeof value.defaultNextKey === "string" ? value.defaultNextKey : "",
    options: Array.isArray(value.options) && value.options.length > 0
      ? value.options.map(parseTreeOption)
      : [createEmptyOption()],
  };
}

function parseMatchRules(value: unknown): TreeMatchRulesDraft {
  if (!isRecord(value)) {
    return {
      includeAny: [],
      excludeAny: [],
      websiteUrl: "",
    };
  }

  return {
    includeAny: parseStringArray(value.includeAny),
    excludeAny: parseStringArray(value.excludeAny),
    websiteUrl: typeof value.websiteUrl === "string" ? value.websiteUrl : "",
  };
}

function createTreeEditorDraft(tree: CannedTree): TreeEditorDraft {
  const nodes = Array.isArray(tree.nodes)
    ? tree.nodes.map((node, index) => parseTreeNode(node, index))
    : [];

  return {
    id: tree.id,
    name: tree.name,
    description: tree.description ?? "",
    active: tree.active,
    rootNodeKey: tree.rootNodeKey,
    nodes,
    matchRules: parseMatchRules(tree.matchRules),
  };
}

function joinList(values: string[]): string {
  return values.join(", ");
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function serializeTreeNode(node: TreeNodeDraft): Record<string, unknown> {
  return {
    key: node.key,
    title: node.title,
    message: node.message,
    ...(node.leadStage ? { leadStage: node.leadStage } : {}),
    ...(node.terminal ? { terminal: true } : {}),
    ...(node.defaultNextKey ? { defaultNextKey: node.defaultNextKey } : {}),
    options: node.options.map((option) => ({
      label: option.label,
      nextKey: option.nextKey,
      ...(option.containsAny.length > 0 ? { containsAny: option.containsAny } : {}),
    })),
  };
}

function serializeMatchRules(matchRules: TreeMatchRulesDraft): Record<string, unknown> | null {
  const payload = {
    ...(matchRules.includeAny.length > 0 ? { includeAny: matchRules.includeAny } : {}),
    ...(matchRules.excludeAny.length > 0 ? { excludeAny: matchRules.excludeAny } : {}),
    ...(matchRules.websiteUrl ? { websiteUrl: matchRules.websiteUrl } : {}),
  };

  return Object.keys(payload).length > 0 ? payload : null;
}

function renameTreeNodeKey(tree: TreeEditorDraft, nodeIndex: number, nextKey: string): TreeEditorDraft {
  const previousKey = tree.nodes[nodeIndex]?.key;
  if (previousKey === undefined || previousKey === nextKey) {
    return tree;
  }

  return {
    ...tree,
    rootNodeKey: tree.rootNodeKey === previousKey ? nextKey : tree.rootNodeKey,
    nodes: tree.nodes.map((node, index) => ({
      ...node,
      key: index === nodeIndex ? nextKey : node.key,
      defaultNextKey: node.defaultNextKey === previousKey ? nextKey : node.defaultNextKey,
      options: node.options.map((option) => ({
        ...option,
        nextKey: option.nextKey === previousKey ? nextKey : option.nextKey,
      })),
    })),
  };
}

function addNodeIssue(nodeIssues: Record<number, string[]>, nodeIndex: number, issue: string): void {
  nodeIssues[nodeIndex] = [...(nodeIssues[nodeIndex] ?? []), issue];
}

function validateTree(tree: TreeEditorDraft): TreeValidationResult {
  const errors: string[] = [];
  const nodeIssues: Record<number, string[]> = {};
  const normalizedKeys = tree.nodes.map((node) => node.key.trim());
  const validKeySet = new Set(normalizedKeys.filter((key) => key.length > 0));
  const keyCounts = normalizedKeys.reduce<Record<string, number>>((counts, key) => {
    if (key.length === 0) {
      return counts;
    }

    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  if (tree.nodes.length === 0) {
    errors.push("Add at least one node before saving this tree.");
  }

  tree.nodes.forEach((node, nodeIndex) => {
    const normalizedKey = node.key.trim();

    if (!normalizedKey) {
      addNodeIssue(nodeIssues, nodeIndex, "Node key is required.");
    } else if ((keyCounts[normalizedKey] ?? 0) > 1) {
      addNodeIssue(nodeIssues, nodeIndex, `Node key \"${normalizedKey}\" is duplicated.`);
    }

    const defaultNextKey = node.defaultNextKey.trim();
    if (defaultNextKey && !validKeySet.has(defaultNextKey)) {
      addNodeIssue(nodeIssues, nodeIndex, `Default transition points to missing node \"${defaultNextKey}\".`);
    }

    node.options.forEach((option, optionIndex) => {
      const nextKey = option.nextKey.trim();
      const optionLabel = option.label.trim() || `transition ${optionIndex + 1}`;

      if (!nextKey) {
        addNodeIssue(nodeIssues, nodeIndex, `${optionLabel} is missing a next node.`);
        return;
      }

      if (!validKeySet.has(nextKey)) {
        addNodeIssue(nodeIssues, nodeIndex, `${optionLabel} points to missing node \"${nextKey}\".`);
      }
    });
  });

  const rootNodeKey = tree.rootNodeKey.trim();
  if (!rootNodeKey) {
    errors.push("Select a root node before saving this tree.");
  } else if (!validKeySet.has(rootNodeKey)) {
    errors.push(`Root node \"${rootNodeKey}\" does not exist.`);
  }

  if (Object.keys(nodeIssues).length > 0) {
    errors.push("Fix the invalid node keys and transitions listed below.");
  }

  return { errors, nodeIssues };
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [trees, setTrees] = useState<TreeEditorDraft[]>([]);
  const [crmProviders, setCrmProviders] = useState<CrmProviderStatus[]>([]);
  const [crmActivities, setCrmActivities] = useState<CrmActivity[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [activityDraft, setActivityDraft] = useState<ActivityDraft>(EMPTY_ACTIVITY_DRAFT);
  const [activityFilters, setActivityFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [crmBusy, setCrmBusy] = useState(false);
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [savingTreeId, setSavingTreeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [leadsResponse, treesResponse, crmResponse] = await Promise.all([
        fetch("/api/leads"),
        fetch("/api/canned-responses"),
        fetch("/api/crm"),
      ]);
      const leadsData = (await leadsResponse.json()) as { leads?: LeadItem[]; error?: string };
      const treesData = (await treesResponse.json()) as { trees?: CannedTree[]; error?: string };
      const crmData = (await crmResponse.json()) as { providers?: CrmProviderStatus[]; error?: string };

      if (!leadsResponse.ok) {
        throw new Error(leadsData.error ?? "Failed to load leads.");
      }
      if (!treesResponse.ok) {
        throw new Error(treesData.error ?? "Failed to load canned response trees.");
      }
      if (!crmResponse.ok) {
        throw new Error(crmData.error ?? "Failed to load CRM status.");
      }

      const nextTrees = (treesData.trees ?? []).map(createTreeEditorDraft);
      const nextLeads = leadsData.leads ?? [];
      setLeads(nextLeads);
      setCrmProviders(crmData.providers ?? []);
      setTrees(nextTrees);
      setSelectedLeadId((current) => current && nextLeads.some((lead) => lead.id === current)
        ? current
        : nextLeads[0]?.id ?? null);
      setSelectedTreeId((current) => current && nextTrees.some((tree) => tree.id === current)
        ? current
        : nextTrees[0]?.id ?? null);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function updateLead(id: string, leadStage: LeadStage): Promise<void> {
    setError(null);
    const response = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadStage }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error ?? "Failed to update lead stage.");
    }

    await load();
  }

  async function loadActivities(contactId: string, filters: ActivityFilters = activityFilters): Promise<void> {
    const params = new URLSearchParams({ contactId });
    if (filters.type !== "all") {
      params.set("type", filters.type);
    }
    if (filters.status !== "all") {
      params.set("status", filters.status);
    }
    if (filters.query.trim()) {
      params.set("query", filters.query.trim());
    }

    const response = await fetch(`/api/crm/activities?${params.toString()}`);
    const data = (await response.json()) as { activities?: CrmActivity[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to load CRM activities.");
    }
    setCrmActivities(data.activities ?? []);
  }

  async function saveCrmContact(contactId: string, updates: {
    summary?: string | null;
    score?: number;
    stage?: LeadStage;
  }): Promise<void> {
    setCrmBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, ...updates }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update CRM contact.");
      }
      await load();
    } catch (crmError) {
      setError(String(crmError));
    } finally {
      setCrmBusy(false);
    }
  }

  async function syncCrmContactNow(contactId: string): Promise<void> {
    setCrmBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as { sync?: { message?: string }; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to sync CRM contact.");
      }
      if (data.sync?.message) {
        setError(data.sync.message);
      }
      await load();
      await loadActivities(contactId, activityFilters);
    } catch (crmError) {
      setError(String(crmError));
    } finally {
      setCrmBusy(false);
    }
  }

  async function createActivity(contactId: string): Promise<void> {
    setCrmBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/crm/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          type: activityDraft.type,
          title: activityDraft.title || undefined,
          subject: activityDraft.subject || undefined,
          body: activityDraft.body,
          ...(activityDraft.type === "task"
            ? {
                status: activityDraft.status,
                priority: activityDraft.priority,
                dueAt: activityDraft.dueAt || undefined,
              }
            : {}),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to create CRM activity.");
      }
      setActivityDraft(EMPTY_ACTIVITY_DRAFT);
      await loadActivities(contactId, activityFilters);
    } catch (crmError) {
      setError(String(crmError));
    } finally {
      setCrmBusy(false);
    }
  }

  async function updateActivityStatus(activityId: string, contactId: string, status: CrmActivity["status"]): Promise<void> {
    setCrmBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update CRM activity.");
      }
      await loadActivities(contactId, activityFilters);
    } catch (crmError) {
      setError(String(crmError));
    } finally {
      setCrmBusy(false);
    }
  }

  async function syncActivityNow(activityId: string, contactId: string): Promise<void> {
    setCrmBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/activities/${activityId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as { sync?: { message?: string }; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to sync CRM activity.");
      }
      if (data.sync?.message) {
        setError(data.sync.message);
      }
      await loadActivities(contactId);
    } catch (crmError) {
      setError(String(crmError));
    } finally {
      setCrmBusy(false);
    }
  }

  async function ensureDefaultTree(): Promise<void> {
    setError(null);
    const response = await fetch("/api/canned-responses", { method: "POST" });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error ?? "Failed to create default tree.");
    }
    await load();
  }

  async function saveTree(id: string): Promise<void> {
    const tree = trees.find((entry) => entry.id === id);
    if (!tree) {
      return;
    }

    const validation = validateTree(tree);
    if (validation.errors.length > 0) {
      setError("Fix the tree validation errors before saving.");
      return;
    }

    setSavingTreeId(id);
    setError(null);

    const fallbackRootNodeKey = tree.nodes.find((node) => node.key === tree.rootNodeKey)?.key
      ?? tree.nodes[0]?.key
      ?? "";

    try {
      const response = await fetch(`/api/canned-responses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tree.name,
          description: tree.description || null,
          active: tree.active,
          rootNodeKey: fallbackRootNodeKey,
          nodes: tree.nodes.map(serializeTreeNode),
          matchRules: serializeMatchRules(tree.matchRules),
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save canned response tree.");
      }

      await load();
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSavingTreeId(null);
    }
  }

  function updateTree(id: string, updater: (tree: TreeEditorDraft) => TreeEditorDraft): void {
    setTrees((current) => current.map((tree) => (tree.id === id ? updater(tree) : tree)));
  }

  function removeNode(id: string, nodeIndex: number): void {
    updateTree(id, (tree) => {
      const removedNode = tree.nodes[nodeIndex];
      const removedKey = removedNode?.key ?? "";
      const nextNodes = tree.nodes.filter((_, index) => index !== nodeIndex);
      const nextRootNodeKey = removedNode?.key === tree.rootNodeKey ? (nextNodes[0]?.key ?? "") : tree.rootNodeKey;

      return {
        ...tree,
        nodes: nextNodes.map((node) => ({
          ...node,
          defaultNextKey: node.defaultNextKey === removedKey ? "" : node.defaultNextKey,
          options: node.options.map((option) => ({
            ...option,
            nextKey: option.nextKey === removedKey ? "" : option.nextKey,
          })),
        })),
        rootNodeKey: nextRootNodeKey,
      };
    });
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedLeadId) {
      setCrmActivities([]);
      return;
    }

    void loadActivities(selectedLeadId, activityFilters).catch((loadError) => {
      setError(String(loadError));
    });
  }, [selectedLeadId, activityFilters]);

  const selectedTree = trees.find((tree) => tree.id === selectedTreeId) ?? null;
  const selectedTreeValidation = selectedTree ? validateTree(selectedTree) : null;
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;
  const activitiesPagination = usePagination(crmActivities, 15);

  return (
    <div className="space-y-5">
      <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] font-medium" style={{ color: "var(--text-muted)" }}>lead pipeline</div>
            <div className="text-sm mt-1" style={{ color: "var(--text-dim)" }}>DM contacts now move through deterministic stages instead of disappearing into the inbox.</div>
          </div>
          <button onClick={() => void load()} className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>refresh</button>
        </div>
        {loading ? <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div> : null}
        {error ? <div className="text-sm" style={{ color: "var(--danger, #d16b6b)" }}>{error}</div> : null}
        <div className="grid gap-4 grid-cols-5">
          {STAGES.map((stage) => (
            <div key={stage} className="space-y-3 min-w-0">
              <div className="text-xs uppercase tracking-[0.2em] font-medium" style={{ color: "var(--text-muted)" }}>{stage}</div>
              {leads.filter((lead) => lead.leadStage === stage).map((lead) => (
                <article key={lead.id} onClick={() => setSelectedLeadId(lead.id)} className="border p-3 space-y-2 cursor-pointer" style={{ borderColor: selectedLeadId === lead.id ? "var(--accent)" : "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                    <span className="truncate">{lead.platform.displayName}</span>
                    <span className="tabular-nums ml-2 shrink-0">{lead.leadScore}</span>
                  </div>
                  <div className="text-sm line-clamp-3">{lead.content}</div>
                  <div className="text-xs truncate" style={{ color: "var(--text-dim)" }}>{lead.authorHandle ?? lead.authorName ?? "unknown lead"}</div>
                  {lead.cannedResponseTree ? <div className="text-xs truncate" style={{ color: "var(--accent)" }}>{lead.cannedResponseTree.name}</div> : null}
                  <select
                    value={lead.leadStage}
                    onChange={(event) => void updateLead(lead.id, event.target.value as LeadStage)}
                    onClick={(event) => event.stopPropagation()}
                    className="w-full bg-transparent border px-2 py-1.5 text-xs"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {STAGES.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  {lead.leadSummary ? <div className="text-xs leading-5 line-clamp-2" style={{ color: "var(--text-dim)" }}>{lead.leadSummary}</div> : null}
                </article>
              ))}
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[0.55fr_0.45fr]">
        <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] font-medium" style={{ color: "var(--text-muted)" }}>canned response trees</div>
            <div className="text-sm mt-1" style={{ color: "var(--text-dim)" }}>Deterministic DM flows that move contacts from greeting to website handoff.</div>
          </div>
          <button onClick={() => void ensureDefaultTree()} className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>ensure default</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {trees.map((tree) => (
            <button
              key={tree.id}
              onClick={() => setSelectedTreeId(tree.id)}
              className="border px-3 py-2 text-left text-xs uppercase tracking-[0.16em]"
              style={{
                borderColor: selectedTreeId === tree.id ? "var(--accent)" : "var(--border-sub)",
                color: selectedTreeId === tree.id ? "var(--accent)" : "var(--text-muted)",
                background: selectedTreeId === tree.id ? "var(--bg-raised)" : "transparent",
              }}
            >
              {tree.name}
            </button>
          ))}
        </div>
        {selectedTree ? (
          <article className="border p-4 space-y-4" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            {selectedTreeValidation && selectedTreeValidation.errors.length > 0 ? (
              <div className="border p-3 space-y-2 text-sm" style={{ borderColor: "var(--danger, #d16b6b)", background: "var(--bg-surface)", color: "var(--danger, #d16b6b)" }}>
                <div className="text-xs uppercase tracking-[0.18em]">validation</div>
                {selectedTreeValidation.errors.map((issue) => (
                  <div key={issue}>{issue}</div>
                ))}
              </div>
            ) : null}
            <div className="grid gap-3">
              <input
                value={selectedTree.name}
                onChange={(event) => updateTree(selectedTree.id, (tree) => ({ ...tree, name: event.target.value }))}
                placeholder="Tree name"
                className="w-full bg-transparent border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
              <textarea
                value={selectedTree.description}
                onChange={(event) => updateTree(selectedTree.id, (tree) => ({ ...tree, description: event.target.value }))}
                placeholder="What this tree handles"
                className="w-full min-h-24 bg-transparent border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>root node</div>
                  <select
                    value={selectedTree.rootNodeKey}
                    onChange={(event) => updateTree(selectedTree.id, (tree) => ({ ...tree, rootNodeKey: event.target.value }))}
                    className="w-full bg-transparent border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <option value="">Select root node</option>
                    {selectedTree.nodes.map((node) => (
                      <option key={node.key} value={node.key}>{node.key}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-3 border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                  <input
                    type="checkbox"
                    checked={selectedTree.active}
                    onChange={(event) => updateTree(selectedTree.id, (tree) => ({ ...tree, active: event.target.checked }))}
                  />
                  <span>Active tree</span>
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1 md:col-span-2">
                  <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>include keywords</div>
                  <input
                    value={joinList(selectedTree.matchRules.includeAny)}
                    onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                      ...tree,
                      matchRules: { ...tree.matchRules, includeAny: splitList(event.target.value) },
                    }))}
                    placeholder="quote, pricing, help"
                    className="w-full bg-transparent border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>website URL</div>
                  <input
                    value={selectedTree.matchRules.websiteUrl}
                    onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                      ...tree,
                      matchRules: { ...tree.matchRules, websiteUrl: event.target.value },
                    }))}
                    placeholder="https://example.com"
                    className="w-full bg-transparent border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  />
                </label>
              </div>
              <label className="space-y-1">
                <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>exclude keywords</div>
                <input
                  value={joinList(selectedTree.matchRules.excludeAny)}
                  onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                    ...tree,
                    matchRules: { ...tree.matchRules, excludeAny: splitList(event.target.value) },
                  }))}
                  placeholder="stop, unsubscribe"
                  className="w-full bg-transparent border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border)" }}
                />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--text-muted)" }}>nodes</div>
              <button
                onClick={() => updateTree(selectedTree.id, (tree) => ({
                  ...tree,
                  nodes: [...tree.nodes, createEmptyNode(tree.nodes.length)],
                  rootNodeKey: tree.rootNodeKey || `node_${tree.nodes.length + 1}`,
                }))}
                className="text-xs uppercase tracking-[0.18em]"
                style={{ color: "var(--accent)" }}
              >
                add node
              </button>
            </div>

            <div className="space-y-4">
              {selectedTree.nodes.map((node, nodeIndex) => (
                <section key={`${node.key}-${nodeIndex}`} className="border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                  <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>node {nodeIndex + 1}</div>
                    <button onClick={() => removeNode(selectedTree.id, nodeIndex)} className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--danger, #d16b6b)" }}>remove</button>
                  </div>
                  {selectedTreeValidation?.nodeIssues[nodeIndex]?.length ? (
                    <div className="border p-3 space-y-1 text-sm" style={{ borderColor: "var(--danger, #d16b6b)", color: "var(--danger, #d16b6b)" }}>
                      {selectedTreeValidation.nodeIssues[nodeIndex].map((issue) => (
                        <div key={issue}>{issue}</div>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      value={node.key}
                      onChange={(event) => updateTree(selectedTree.id, (tree) => renameTreeNodeKey(tree, nodeIndex, event.target.value))}
                      placeholder="node key"
                      className="w-full bg-transparent border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--border)" }}
                    />
                    <input
                      value={node.title}
                      onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                        ...tree,
                        nodes: tree.nodes.map((entry, index) => index === nodeIndex ? { ...entry, title: event.target.value } : entry),
                      }))}
                      placeholder="node title"
                      className="w-full bg-transparent border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--border)" }}
                    />
                  </div>
                  <textarea
                    value={node.message}
                    onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                      ...tree,
                      nodes: tree.nodes.map((entry, index) => index === nodeIndex ? { ...entry, message: event.target.value } : entry),
                    }))}
                    placeholder="Reply template. Supports {{firstName}}, {{authorName}}, and {{websiteUrl}}."
                    className="w-full min-h-28 bg-transparent border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  />
                  <div className="grid gap-3 md:grid-cols-3">
                    <select
                      value={node.leadStage}
                      onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                        ...tree,
                        nodes: tree.nodes.map((entry, index) => index === nodeIndex ? { ...entry, leadStage: event.target.value as TreeLeadStage } : entry),
                      }))}
                      className="w-full bg-transparent border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <option value="">No lead stage change</option>
                      {STAGES.map((stage) => (
                        <option key={stage} value={stage}>{stage}</option>
                      ))}
                    </select>
                    <select
                      value={node.defaultNextKey}
                      onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                        ...tree,
                        nodes: tree.nodes.map((entry, index) => index === nodeIndex ? { ...entry, defaultNextKey: event.target.value } : entry),
                      }))}
                      className="w-full bg-transparent border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <option value="">No default transition</option>
                      {selectedTree.nodes.map((entry) => (
                        <option key={entry.key} value={entry.key}>{entry.key}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-3 border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      <input
                        type="checkbox"
                        checked={node.terminal}
                        onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                          ...tree,
                          nodes: tree.nodes.map((entry, index) => index === nodeIndex ? { ...entry, terminal: event.target.checked } : entry),
                        }))}
                      />
                      <span>Terminal node</span>
                    </label>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>transitions</div>
                      <button
                        onClick={() => updateTree(selectedTree.id, (tree) => ({
                          ...tree,
                          nodes: tree.nodes.map((entry, index) => index === nodeIndex ? { ...entry, options: [...entry.options, createEmptyOption()] } : entry),
                        }))}
                        className="text-xs uppercase tracking-[0.16em]"
                        style={{ color: "var(--accent)" }}
                      >
                        add transition
                      </button>
                    </div>
                    {node.options.map((option, optionIndex) => (
                      <div key={`${node.key}-option-${optionIndex}`} className="grid gap-3 border p-3 md:grid-cols-[1fr_1fr_1.4fr_auto]" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                        <input
                          value={option.label}
                          onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                            ...tree,
                            nodes: tree.nodes.map((entry, index) => index === nodeIndex
                              ? {
                                  ...entry,
                                  options: entry.options.map((candidate, candidateIndex) => candidateIndex === optionIndex ? { ...candidate, label: event.target.value } : candidate),
                                }
                              : entry),
                          }))}
                          placeholder="label"
                          className="w-full bg-transparent border px-3 py-2 text-sm"
                          style={{ borderColor: "var(--border)" }}
                        />
                        <select
                          value={option.nextKey}
                          onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                            ...tree,
                            nodes: tree.nodes.map((entry, index) => index === nodeIndex
                              ? {
                                  ...entry,
                                  options: entry.options.map((candidate, candidateIndex) => candidateIndex === optionIndex ? { ...candidate, nextKey: event.target.value } : candidate),
                                }
                              : entry),
                          }))}
                          className="w-full bg-transparent border px-3 py-2 text-sm"
                          style={{ borderColor: "var(--border)" }}
                        >
                          <option value="">Next node</option>
                          {selectedTree.nodes.map((entry) => (
                            <option key={entry.key} value={entry.key}>{entry.key}</option>
                          ))}
                        </select>
                        <input
                          value={joinList(option.containsAny)}
                          onChange={(event) => updateTree(selectedTree.id, (tree) => ({
                            ...tree,
                            nodes: tree.nodes.map((entry, index) => index === nodeIndex
                              ? {
                                  ...entry,
                                  options: entry.options.map((candidate, candidateIndex) => candidateIndex === optionIndex ? { ...candidate, containsAny: splitList(event.target.value) } : candidate),
                                }
                              : entry),
                          }))}
                          placeholder="trigger words, comma separated"
                          className="w-full bg-transparent border px-3 py-2 text-sm"
                          style={{ borderColor: "var(--border)" }}
                        />
                        <button
                          onClick={() => updateTree(selectedTree.id, (tree) => ({
                            ...tree,
                            nodes: tree.nodes.map((entry, index) => index === nodeIndex
                              ? { ...entry, options: entry.options.filter((_, candidateIndex) => candidateIndex !== optionIndex) }
                              : entry),
                          }))}
                          className="text-xs uppercase tracking-[0.16em]"
                          style={{ color: "var(--danger, #d16b6b)" }}
                        >
                          remove
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                Match rules decide when this tree is chosen. Each node can advance the lead stage and branch by keyword-triggered transitions.
              </div>
              <button
                onClick={() => void saveTree(selectedTree.id)}
                disabled={savingTreeId === selectedTree.id || (selectedTreeValidation?.errors.length ?? 0) > 0}
                className="px-4 py-2 border text-xs uppercase tracking-[0.18em]"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", opacity: savingTreeId === selectedTree.id || (selectedTreeValidation?.errors.length ?? 0) > 0 ? 0.6 : 1 }}
              >
                {savingTreeId === selectedTree.id ? "saving" : "save tree"}
              </button>
            </div>
          </article>
        ) : (
          <div className="text-sm leading-7" style={{ color: "var(--text-dim)" }}>
            No tree available yet. Use ensure default to seed the default qualification funnel.
          </div>
        )}
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.38fr_0.62fr]">
        <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] font-medium" style={{ color: "var(--text-muted)" }}>CRM cockpit</div>
              <div className="text-sm mt-1" style={{ color: "var(--text-dim)" }}>Selected contact, provider state, and sync controls.</div>
            </div>
            <button onClick={() => void load()} className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>refresh CRM</button>
          </div>

          <div className="grid gap-3 grid-cols-2">
            {crmProviders.map((provider) => (
              <div key={provider.name} className="border p-3" style={{ borderColor: provider.active ? "var(--accent)" : "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm">{provider.label}</span>
                  <span className="text-xs uppercase tracking-[0.18em]" style={{ color: provider.connected ? "var(--success)" : "var(--danger)" }}>{provider.mode}</span>
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{provider.active ? "active provider" : "available"}</div>
              </div>
            ))}
          </div>

          {selectedLead ? (
            <div className="space-y-3 border p-4" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm">{selectedLead.authorName ?? selectedLead.authorHandle ?? "Unknown contact"}</div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{selectedLead.authorHandle ?? selectedLead.id}</div>
                </div>
                <button onClick={() => void syncCrmContactNow(selectedLead.id)} disabled={crmBusy} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)", opacity: crmBusy ? 0.6 : 1 }}>
                  sync contact
                </button>
              </div>

              <div className="grid gap-3 grid-cols-2">
                <label className="space-y-1">
                  <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Stage</div>
                  <select value={selectedLead.leadStage} onChange={(event) => void saveCrmContact(selectedLead.id, { stage: event.target.value as LeadStage })} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                    {STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Score</div>
                  <input defaultValue={selectedLead.leadScore} onBlur={(event) => void saveCrmContact(selectedLead.id, { score: Number.parseInt(event.target.value, 10) || 0 })} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                </label>
              </div>

              <label className="space-y-1 block">
                <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Summary</div>
                <textarea defaultValue={selectedLead.leadSummary ?? ""} onBlur={(event) => void saveCrmContact(selectedLead.id, { summary: event.target.value || null })} className="w-full min-h-28 bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </label>
            </div>
          ) : (
            <div className="text-sm leading-7" style={{ color: "var(--text-dim)" }}>Select a lead from the pipeline to manage CRM notes, tasks, and provider sync.</div>
          )}
        </section>

        <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div>
            <div className="text-xs uppercase tracking-[0.24em] font-medium" style={{ color: "var(--text-muted)" }}>notes and tasks</div>
            <div className="text-sm mt-1" style={{ color: "var(--text-dim)" }}>Create local CRM activities and push them to the active provider when needed.</div>
          </div>

          {selectedLead ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[0.45fr_0.55fr]">
                <div className="space-y-3 border p-4" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select value={activityDraft.type} onChange={(event) => setActivityDraft((current) => ({ ...current, type: event.target.value as ActivityDraft["type"] }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      <option value="note">note</option>
                      <option value="task">task</option>
                    </select>
                    <input value={activityDraft.title} onChange={(event) => setActivityDraft((current) => ({ ...current, title: event.target.value }))} placeholder="title" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                  </div>
                  <input value={activityDraft.subject} onChange={(event) => setActivityDraft((current) => ({ ...current, subject: event.target.value }))} placeholder="subject" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                  <textarea value={activityDraft.body} onChange={(event) => setActivityDraft((current) => ({ ...current, body: event.target.value }))} placeholder="Call notes, follow-up plan, or next action" className="w-full min-h-28 bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                  {activityDraft.type === "task" ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <select value={activityDraft.status} onChange={(event) => setActivityDraft((current) => ({ ...current, status: event.target.value as ActivityDraft["status"] }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                        <option value="pending">pending</option>
                        <option value="completed">completed</option>
                      </select>
                      <select value={activityDraft.priority} onChange={(event) => setActivityDraft((current) => ({ ...current, priority: event.target.value as ActivityDraft["priority"] }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                      <input type="datetime-local" value={activityDraft.dueAt} onChange={(event) => setActivityDraft((current) => ({ ...current, dueAt: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                    </div>
                  ) : null}
                  <button onClick={() => void createActivity(selectedLead.id)} disabled={crmBusy || !activityDraft.body.trim()} className="px-4 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)", opacity: crmBusy || !activityDraft.body.trim() ? 0.6 : 1 }}>
                    add activity
                  </button>
                </div>

                <div className="space-y-3 max-h-[520px] overflow-auto">
                  <div className="grid gap-3 border p-3 md:grid-cols-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-surface)" }}>
                    <select value={activityFilters.type} onChange={(event) => setActivityFilters((current) => ({ ...current, type: event.target.value as ActivityFilters["type"] }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      <option value="all">all types</option>
                      <option value="note">notes</option>
                      <option value="task">tasks</option>
                    </select>
                    <select value={activityFilters.status} onChange={(event) => setActivityFilters((current) => ({ ...current, status: event.target.value as ActivityFilters["status"] }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      <option value="all">all statuses</option>
                      <option value="logged">logged</option>
                      <option value="pending">pending</option>
                      <option value="completed">completed</option>
                    </select>
                    <input value={activityFilters.query} onChange={(event) => setActivityFilters((current) => ({ ...current, query: event.target.value }))} placeholder="Search notes and tasks" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                  </div>
                  {crmActivities.length === 0 ? (
                    <div className="text-sm leading-7" style={{ color: "var(--text-dim)" }}>No CRM activities yet for this contact.</div>
                  ) : activitiesPagination.pageItems.map((activity) => (
                    <article key={activity.id} className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm">{activity.title ?? activity.subject ?? activity.type}</div>
                          <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{activity.type} • {activity.status}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <select
                            value={activity.status}
                            onChange={(event) => void updateActivityStatus(activity.id, selectedLead.id, event.target.value as CrmActivity["status"])}
                            disabled={crmBusy || activity.type === "note"}
                            className="bg-transparent border px-3 py-2 text-xs uppercase tracking-[0.16em]"
                            style={{ borderColor: "var(--border)", color: "var(--text-muted)", opacity: crmBusy || activity.type === "note" ? 0.6 : 1 }}
                          >
                            {activity.type === "note" ? <option value="logged">logged</option> : null}
                            {activity.type === "task" ? <option value="pending">pending</option> : null}
                            {activity.type === "task" ? <option value="completed">completed</option> : null}
                          </select>
                          <button onClick={() => void syncActivityNow(activity.id, selectedLead.id)} disabled={crmBusy} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)", opacity: crmBusy ? 0.6 : 1 }}>
                            sync
                          </button>
                        </div>
                      </div>
                      <div className="text-sm whitespace-pre-wrap">{activity.body}</div>
                      <div className="flex flex-wrap gap-3 text-xs" style={{ color: "var(--text-dim)" }}>
                        {activity.priority ? <span>priority {activity.priority}</span> : null}
                        {activity.dueAt ? <span>due {new Date(activity.dueAt).toLocaleString()}</span> : null}
                        {activity.syncedAt ? <span>synced {new Date(activity.syncedAt).toLocaleString()}</span> : <span>not yet synced</span>}
                      </div>
                    </article>
                  ))}
                  <PaginationControls {...activitiesPagination} />
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm leading-7" style={{ color: "var(--text-dim)" }}>Choose a pipeline contact to review notes and follow-up tasks.</div>
          )}
        </section>
      </div>
    </div>
  );
}