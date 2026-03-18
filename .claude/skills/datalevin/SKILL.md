---
name: datalevin
description: "Datalevin embedded Datalog database. Schema design, connection lifecycle, transactions, queries, entity API, and test fixtures. Canonical datalevin.core usage — no wrappers, no transactor."
---

# Datalevin — Embedded Datalog Database

Styrmann uses canonical `datalevin.core` directly. No wrappers, no transactor service, no middleware.

## Connection Lifecycle

```clojure
(require '[datalevin.core :as d])

;; Open with schema
(def conn (d/get-conn "data/styrmann" schema))

;; Get current DB value (immutable snapshot)
(def db (d/db conn))

;; Close when done
(d/close conn)
```

### Styrmann Convention

Connection is managed in `com.blockether.styrmann.db.core`:

```clojure
(require '[com.blockether.styrmann.db.core :as db])

(db/start! "data/styrmann")   ;; open + store in atom
(db/stop!)                    ;; close + clear atom
(db/conn)                     ;; get connection (throws if not started)
(db/db)                       ;; get current DB snapshot
```

---

## Schema Design

### Rules

| Rule | Example |
|------|---------|
| ALL `/id` attributes need `:db/unique :db.unique/identity` | Required for lookup refs |
| UUIDs for identity, never strings | `(UUID/randomUUID)` |
| Timestamps use `:db.type/instant` | ALL `-at` fields use `(java.util.Date.)` |
| Enums MUST use namespaced keywords | `:ticket/status` -> `:ticket.status/backlog`, `:ticket.status/active` — NEVER bare `:backlog` |
| Every attribute MUST have `:db/valueType` and `:db/doc` | No exceptions |
| Refs use `:db.type/ref` | `:ticket/milestone` points to milestone entity |
| `:db/isComponent true` for owned sub-entities | Enables cascade retraction |

### Schema Pattern

Each domain defines schema in its own namespace:

```clojure
(def schema
  {:ticket/id          {:db/valueType :db.type/uuid
                        :db/unique    :db.unique/identity
                        :db/doc       "Unique ticket identifier"}
   :ticket/title       {:db/valueType :db.type/string
                        :db/doc       "Short title"}
   :ticket/status      {:db/valueType :db.type/keyword
                        :db/doc       "One of :ticket.status/backlog :ticket.status/active :ticket.status/done :ticket.status/cancelled"}
   :ticket/created-at  {:db/valueType :db.type/instant
                        :db/doc       "Creation timestamp"}
   :ticket/milestone   {:db/valueType :db.type/ref
                        :db/doc       "Ref to milestone (nil = backlog)"}})
```

### Migrations

Schema is additive only — never modify existing attributes. For new attributes, merge into existing schema before `d/get-conn`.

---

## Transactions

### Create

```clojure
(d/transact! conn [{:ticket/id          (UUID/randomUUID)
                     :ticket/title       "Implement login"
                     :ticket/status      :ticket.status/backlog
                     :ticket/created-at  (java.util.Date.)}])
```

### Update (upsert by identity)

```clojure
;; Datalevin upserts when :db/unique identity matches
(d/transact! conn [{:ticket/id     existing-uuid
                     :ticket/status :ticket.status/active}])
```

### Add Ref

```clojure
;; Assign ticket to milestone via lookup ref
(d/transact! conn [{:ticket/id        ticket-uuid
                     :ticket/milestone [:milestone/id milestone-uuid]}])
```

### Remove Ref

```clojure
;; Retract a specific attribute
(d/transact! conn [[:db/retract [:ticket/id ticket-uuid] :ticket/milestone]])
```

### Delete Entity

```clojure
(d/transact! conn [[:db/retractEntity [:ticket/id ticket-uuid]]])
```

---

## Queries

### Find All (pull many)

```clojure
(d/q '[:find [(pull ?e [*]) ...]
       :where [?e :ticket/id _]]
     (d/db conn))
```

### Find by Identity

```clojure
;; Pull by lookup ref — PREFERRED
(d/pull (d/db conn) '[*] [:ticket/id some-uuid])

;; Pull specific attributes
(d/pull (d/db conn) [:ticket/title :ticket/status] [:ticket/id some-uuid])
```

### Find with Filter

```clojure
;; Tickets in backlog
(d/q '[:find [(pull ?e [*]) ...]
       :in $ ?status
       :where
       [?e :ticket/id _]
       [?e :ticket/status ?status]]
     (d/db conn) :ticket.status/backlog)
```

### Find with Ref Join

```clojure
;; Tickets for a specific milestone
(d/q '[:find [(pull ?t [*]) ...]
       :in $ ?mid
       :where
       [?m :milestone/id ?mid]
       [?t :ticket/milestone ?m]]
     (d/db conn) milestone-uuid)
```

### Scalar Result

```clojure
;; Single value with `. `
(d/q '[:find ?title .
       :in $ ?id
       :where [?e :ticket/id ?id]
              [?e :ticket/title ?title]]
     (d/db conn) some-uuid)
```

### Count

```clojure
(d/q '[:find (count ?e) .
       :where [?e :ticket/id _]]
     (d/db conn))
```

---

## Entity API

Lazy, map-like access to entities. Cheap to create — attributes fetched on demand.

```clojure
;; Get entity (lazy — no DB read yet)
(def e (d/entity (d/db conn) [:ticket/id some-uuid]))

;; Access attributes (triggers read)
(:ticket/title e)        ;; => "Implement login"
(:ticket/status e)       ;; => :ticket.status/backlog

;; Navigate refs
(:ticket/milestone e)    ;; => entity for the milestone

;; Reverse refs (prepend _ to name)
(:ticket/_milestone (d/entity (d/db conn) [:milestone/id mid]))
;; => seq of ticket entities pointing to this milestone

;; Eagerly load all attributes (debug only)
(d/touch e)  ;; => {:db/id 1, :ticket/id #uuid "...", :ticket/title "...", ...}
```

**Use `d/pull` for data, `d/entity` for navigation.** Entity retains DB reference — don't hold across transactions.

---

## Architecture Layers

```
com.blockether.styrmann.domain/     Pure logic. Receives conn, returns data. Testable.
  ticket.clj                        Ticket operations (create, promote, list)
  milestone.clj                     Milestone operations
  sprint.clj                        Sprint operations

com.blockether.styrmann.db/         Database plumbing only.
  schema.clj                        Schema definition
  core.clj                          Connection lifecycle (start!/stop!/conn/db)

com.blockether.styrmann.presentation/  Ring handlers, Datastar SSE. Calls domain fns.
```

Domain functions take `conn` as first argument — no global state dependency. This makes them directly testable with temp databases.

### Domain Function Pattern

```clojure
(ns com.blockether.styrmann.domain.ticket
  "Ticket domain logic. All functions take conn as first arg."
  (:require [datalevin.core :as d])
  (:import [java.util UUID Date]))

(defn create!
  "Create a new ticket in backlog. Returns the ticket map."
  [conn {:keys [title description]}]
  (let [ticket {:ticket/id          (UUID/randomUUID)
                :ticket/title       title
                :ticket/description description
                :ticket/status      :ticket.status/backlog
                :ticket/created-at  (Date.)}]
    (d/transact! conn [ticket])
    ticket))

(defn find-by-id
  "Find ticket by UUID. Returns entity map or nil."
  [conn id]
  (let [result (d/pull (d/db conn) '[*] [:ticket/id id])]
    (when (:ticket/id result) result)))

(defn list-by-status
  "List all tickets with the given status."
  [conn status]
  (d/q '[:find [(pull ?e [*]) ...]
         :in $ ?status
         :where
         [?e :ticket/id _]
         [?e :ticket/status ?status]]
       (d/db conn) status))
```

---

## Test Fixtures

### Temp Database Macro

Domain functions take `conn` — no global state needed in tests.

```clojure
(ns com.blockether.styrmann.test-helpers
  (:require [datalevin.core :as d]
            [com.blockether.styrmann.db.schema :as schema])
  (:import [java.util UUID]))

(defmacro with-temp-conn
  "Execute body with a fresh Datalevin conn bound to `sym`.
   DB is created in a temp dir and cleaned up after."
  [[sym] & body]
  `(let [dir# (str "/tmp/styrmann-test-" (UUID/randomUUID))
         ~sym (d/get-conn dir# schema/schema)]
     (try
       ~@body
       (finally
         (d/close ~sym)
         (babashka.fs/delete-tree dir#)))))
```

### Lazytest Integration

```clojure
(defdescribe ticket-test
  (describe "create!"
    (it "creates a ticket in backlog with the given title"
      (with-temp-conn [conn]
        (let [ticket (sut/create! conn {:title "Implement login"})]
          ;; Assert EXACT values, not duck types
          (expect (= "Implement login" (:ticket/title ticket)))
          (expect (= :ticket.status/backlog (:ticket/status ticket)))
          ;; Verify it persisted
          (let [found (sut/find-by-id conn (:ticket/id ticket))]
            (expect (= "Implement login" (:ticket/title found)))))))))
```

### Test Rules

- **No mocks.** Tests use real temp Datalevin instances.
- **Assert exact values.** `(expect (= "Implement login" (:ticket/title t)))` not `(expect (string? (:ticket/title t)))`.
- **TDD always.** Write the test first, watch it fail, then implement.
- **Test domain layer directly.** Pass `conn` to domain functions — no HTTP, no presentation.

---

## Anti-Patterns

| Anti-Pattern | Fix |
|--------------|-----|
| Bare keyword enums `:backlog` | ALWAYS namespaced: `:ticket.status/backlog`, `:sprint.status/active` |
| Passing schema to every `d/get-conn` call | Define schema once, pass at connection open |
| Using string IDs | ALWAYS `(UUID/randomUUID)` |
| `(str (UUID/randomUUID))` | Just `(UUID/randomUUID)` — Datalevin stores UUIDs natively |
| Raw `d/transact!` in handlers | Encapsulate in domain functions |
| Forgetting `:db/doc` | Every attribute must document itself |
| Mutable DB ref in queries | Always `(d/db conn)` for a consistent snapshot |
| Modifying existing schema attrs | Schema is additive only — add new attrs, never change existing |

---

## Debugging

```bash
# Inspect DB contents via REPL
clj-nrepl-eval -p 7888 "(require '[datalevin.core :as d]) (d/q '[:find [(pull ?e [*]) ...] :where [?e :ticket/id _]] (d/db (com.blockether.styrmann.db.core/conn)))"

# Count entities
clj-nrepl-eval -p 7888 "(d/q '[:find (count ?e) . :where [?e :ticket/id _]] (d/db (com.blockether.styrmann.db.core/conn)))"

# Inspect schema
clj-nrepl-eval -p 7888 "(d/schema (d/db (com.blockether.styrmann.db.core/conn)))"
```
