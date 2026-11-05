# Architecture Overview

This document details the architectural boundaries, dependency flows, and separation of concerns in the QR Restaurant Monorepo.

---

## 1. Monorepo Structural Boundaries

The repository is organized into strictly isolated workspaces orchestrated via Turborepo:

```mermaid
flowchart TD
    subgraph ClientLayer["Frontend Workspace (frontend)"]
        UI["Next.js App Router (UI / Pages / Components)"]
        State["Client State (Zustand Stores)"]
        ApiClient["Centralized API Client (src/services/api/index.ts)"]
        UI --> State
        State --> ApiClient
    end

    subgraph SharedLayer["Shared Contracts (packages/shared)"]
        Types["TypeScript Interfaces & Types"]
        Validation["Zod Schemas & Constants"]
    end

    subgraph ServerLayer["Backend Workspace (backend)"]
        API["Express API Server (src/app.ts)"]
        MW["Middleware (Auth, RBAC, Rate-Limit, ErrorHandler)"]
        Controllers["Controllers & Business Logic"]
        Prisma["Prisma ORM (backend/prisma)"]
        API --> MW
        MW --> Controllers
        Controllers --> Prisma
    end

    subgraph StorageLayer["Data & Persistence"]
        DB[("PostgreSQL 16")]
        Cache[("Redis (Sessions & Rate Limiting)")]
        Prisma --> DB
        MW --> Cache
    end

    %% Architectural Boundaries
    ApiClient -- "HTTP / REST & WebSocket (/api/v1)" --> API
    UI -. "Imports Types Only" .-> Types
    Controllers -. "Imports Types & Schemas" .-> Types
```

---

## 2. Hard Isolation Rules

1. **Strict No-Cross-Imports**:
   - `frontend/` MUST NEVER import from `backend/`
   - `backend/` MUST NEVER import from `frontend/`
   - Enforced by ESLint rule `no-restricted-imports` and TypeScript path resolution.
2. **Centralized Communication Gate**:
   - The frontend communicates with the backend exclusively through HTTP REST calls and WebSocket events originating from `frontend/src/services/api/index.ts`.
3. **Shared Contracts**:
   - Data transfer object (DTO) interfaces, role enums, and order status definitions reside in `packages/shared`.
   - `packages/shared` compiles before frontend and backend via Turbo pipeline dependency (`^build`).
4. **Database Encapsulation**:
   - The Prisma Client and schema are private to `backend/`. The frontend never has direct access to the database or Prisma schemas.

---

## 3. Request Lifecycle & Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Diner / Owner
    participant Web as Next.js Web App
    participant Client as API Client (services/api)
    participant Router as Express Router
    participant Auth as Auth & RBAC Middleware
    participant Controller as Business Controller
    participant DB as PostgreSQL (Prisma)

    Customer->>Web: Interacts with UI (e.g. Place Order)
    Web->>Client: Call api.orders.create(orderPayload)
    Client->>Router: POST /api/v1/orders (Bearer JWT in Header)
    Router->>Auth: Verify JWT & Validate User/Tenant
    alt Token Invalid / Expired
        Auth-->>Client: 401 Unauthorized
        Client-->>Web: Redirect or trigger refresh
    else Valid Tenant Session
        Auth->>Controller: Pass Request with req.user & req.tenant
        Controller->>DB: Prisma Transaction (Create Order & Items)
        DB-->>Controller: Persisted Order Entity
        Controller-->>Router: Response (201 Created + Clean DTO)
        Router-->>Client: JSON Response
        Client-->>Web: Updated Order State
    end
```

---

## 4. Real-time Kitchen & Waiter Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Diner as Customer at Table 4
    participant DinerApp as Customer Mobile Web
    participant Server as Socket.io Server (backend)
    participant KitchenApp as Kitchen Display System (KDS)
    participant WaiterApp as Waiter Mobile App

    DinerApp->>Server: POST /menu/rest-123/call-waiter { table: 4 }
    Server->>Server: Validate table session & restaurant
    Server->>WaiterApp: Emit "waiter:called" { tableNumber: 4, timestamp }
    WaiterApp-->>Diner: Waiter arrives at table

    Diner->>DinerApp: Confirms Cart Order
    DinerApp->>Server: POST /api/v1/orders
    Server->>Server: Commit order to PostgreSQL
    Server->>KitchenApp: Emit "order:created" { orderId, items, table: 4 }
    KitchenApp->>KitchenApp: Play sound alert & render new KDS ticket
```

---

## 5. Deployment Topology

- **Web Service (Frontend)**: Deployed as a containerized Next.js service or Static Web App via `docker/Dockerfile.frontend`.
- **API Service (Backend)**: Deployed as an Express container via `docker/Dockerfile.backend` with horizontal scaling capability.
- **Database**: Managed PostgreSQL instance with SSL connections enforced (`sslmode=require`).
- **Cache**: Managed Redis cluster for rate limiting and socket session synchronization.
