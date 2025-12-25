import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Load .env from repo root so DATA_DIR matches the GUI server
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: true });

import { createProject } from '../dist/tools/projectTools.js';
import { splitTasks } from '../dist/tools/task/management.js';

const BASE = 'd:/D Drive/Projects/MCP Servers/Agent Flow/_demo_projects';

async function run() {
  // Create 3 distinct projects (workspace_path drives stable unique IDs)
  const projects = [
    {
      project_name: 'E-Commerce Platform',
      project_description: 'Full-stack e-commerce platform with catalog, cart, checkout, payments, inventory.',
      tech_stack: ['React', 'Node.js', 'PostgreSQL', 'Stripe'],
      workspace_path: `${BASE}/ecommerce`,
      tasks: [
        { name: 'Design Product/Order Schema', description: 'Design DB schema for users, products, orders, order_items; include indexes for hot queries.' },
        { name: 'Build Product List API', description: 'Create endpoints for product listing, search, filters, pagination; include basic validation.' },
        { name: 'Implement Checkout Flow', description: 'Add checkout endpoint that creates an order from cart items; ensure idempotency key support.' },
        { name: 'Integrate Stripe Payments', description: 'Create Stripe payment intent flow and webhook handler for payment succeeded/failed.', dependencies: ['Implement Checkout Flow'] },
        { name: 'Add Tests for Checkout', description: 'Add unit tests for pricing, tax calculation, and checkout happy-path + failure cases.', dependencies: ['Implement Checkout Flow', 'Integrate Stripe Payments'] },
      ],
    },
    {
      project_name: 'Mobile App',
      project_description: 'iOS/Android app with auth, offline-first product browsing, and push notifications.',
      tech_stack: ['React Native', 'TypeScript', 'Redux'],
      workspace_path: `${BASE}/mobile`,
      tasks: [
        { name: 'Design App Navigation', description: 'Define navigation structure (auth stack + main tabs) and route names.' },
        { name: 'Implement Login Screen', description: 'Build login UI + basic validation; wire to API client stub.' },
        { name: 'Add Offline Cache Layer', description: 'Implement offline cache for product list; define cache invalidation strategy.' },
        { name: 'Build Product List Screen', description: 'Implement product list with search + infinite scroll; handle loading/error states.', dependencies: ['Design App Navigation', 'Add Offline Cache Layer'] },
        { name: 'Mobile Test Setup', description: 'Configure Jest test runner and add at least 3 component tests.' },
      ],
    },
    {
      project_name: 'DevOps Infrastructure',
      project_description: 'Kubernetes, CI/CD, observability, backups, and disaster recovery automation.',
      tech_stack: ['Kubernetes', 'Terraform', 'GitHub Actions', 'Prometheus'],
      workspace_path: `${BASE}/devops`,
      tasks: [
        { name: 'Provision K8s Cluster', description: 'Provision a Kubernetes cluster with node pools, RBAC, and network policies.' },
        { name: 'Setup CI/CD Pipeline', description: 'Add pipeline to build, scan, and deploy; include rollback strategy.', dependencies: ['Provision K8s Cluster'] },
        { name: 'Configure Prometheus/Grafana', description: 'Deploy monitoring stack; create basic dashboards and alert rules.', dependencies: ['Provision K8s Cluster'] },
        { name: 'Centralize Logging', description: 'Ship logs to a centralized store; set retention and basic queries.' },
        { name: 'Disaster Recovery Runbook', description: 'Document backup/restore steps; test RTO/RPO assumptions.', dependencies: ['Provision K8s Cluster'] },
      ],
    },
  ];

  // Start clean so the UI is obvious
  await splitTasks({
    updateMode: 'clearAllTasks',
    tasks: [{ name: '(Seed) Reset', description: 'Reset tasks before seeding demo data.' }],
  });

  for (const p of projects) {
    await createProject({
      project_name: p.project_name,
      project_description: p.project_description,
      tech_stack: p.tech_stack,
      workspace_path: p.workspace_path,
    });

    await splitTasks({
      updateMode: 'append',
      tasks: p.tasks,
    });
  }

  console.log('Seed complete: 3 projects, 15 tasks');
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
