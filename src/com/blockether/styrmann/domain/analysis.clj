(ns com.blockether.styrmann.domain.analysis
  "Ticket decomposition into task dependency graphs via Svar.

   Flow:
   1. Load ticket description + acceptance criteria + workspace list
   2. Svar ask! → raw graph specs (structured JSON)
   3. validate-graph (pure, no DB) → {:valid true} or {:valid false :errors [...]}
   4. If invalid → append errors to messages, retry ask! (up to N attempts)
   5. If valid → create-graph! (single DB transaction)

   The retry loop feeds structured validation errors back to the LLM so it
   can self-correct cycles, out-of-bounds indices, blank descriptions, etc."
  (:require
   [clojure.edn :as edn]
   [clojure.string :as str]
   [com.blockether.svar.core :as svar]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.ticket :as db.ticket]
   [com.blockether.styrmann.domain.task :as task]))

;; -- Svar spec for task graph ------------------------------------------------

(def ^:private task-spec
  "Svar spec for a single task node in the dependency graph."
  (svar/spec :Task
    (svar/field {svar/NAME        :workspace-id
                 svar/TYPE        svar/TYPE_STRING
                 svar/CARDINALITY svar/CARDINALITY_ONE
                 svar/DESCRIPTION "UUID string of the target workspace for this task"
                 svar/REQUIRED    true})
    (svar/field {svar/NAME        :description
                 svar/TYPE        svar/TYPE_STRING
                 svar/CARDINALITY svar/CARDINALITY_ONE
                 svar/DESCRIPTION "Concise description of the task's goal (1-2 sentences)"
                 svar/REQUIRED    true})
    (svar/field {svar/NAME        :acceptance-criteria
                 svar/TYPE        svar/TYPE_STRING
                 svar/CARDINALITY svar/CARDINALITY_MANY
                 svar/DESCRIPTION "Scoped acceptance criteria for this task only"
                 svar/REQUIRED    true})
    (svar/field {svar/NAME        :cove-questions
                 svar/TYPE        svar/TYPE_STRING
                 svar/CARDINALITY svar/CARDINALITY_MANY
                 svar/DESCRIPTION "CoVe verification questions to confirm this task is done"
                 svar/REQUIRED    true})
    (svar/field {svar/NAME        :depends-on-indices
                 svar/TYPE        svar/TYPE_INT
                 svar/CARDINALITY svar/CARDINALITY_MANY
                 svar/DESCRIPTION "0-based indices of tasks in the array that must complete before this task. Empty array for root tasks."
                 svar/REQUIRED    true})))

(def ^:private graph-spec
  "Svar spec for the full task dependency graph (array of Task nodes)."
  (svar/spec :TaskGraph
    {:refs [task-spec]}
    (svar/field {svar/NAME        :tasks
                 svar/TYPE        svar/TYPE_REF
                 svar/TARGET      :Task
                 svar/CARDINALITY svar/CARDINALITY_MANY
                 svar/DESCRIPTION "Ordered array of task nodes forming a DAG. Reference other tasks by 0-based index in depends-on-indices."
                 svar/REQUIRED    true})))

;; -- System prompt -----------------------------------------------------------

(defn- build-system-prompt
  "Build the system prompt for ticket decomposition."
  [ticket workspaces]
  (let [ws-list (str/join "\n"
                          (map (fn [ws]
                                 (str "- " (:workspace/name ws)
                                      " (id: " (:workspace/id ws) ")"
                                      " — repo: " (:workspace/repository ws)))
                               workspaces))
        ac-text (or (:ticket/acceptance-criteria-edn ticket) "[]")
        criteria (try (edn/read-string ac-text) (catch Exception _ []))]
    (str "You are a technical project manager decomposing a ticket into implementation tasks.\n\n"
         "## Ticket\n"
         "**Title:** " (:ticket/title ticket) "\n"
         "**Description:** " (:ticket/description ticket) "\n"
         "**Acceptance Criteria:**\n"
         (str/join "\n" (map (fn [c] (str "- " (if (map? c) (:text c) (str c)))) criteria))
         "\n\n"
         "## Available Workspaces\n"
         ws-list
         "\n\n"
         "## Instructions\n"
         "Decompose this ticket into the smallest meaningful tasks.\n"
         "Each task targets exactly one workspace.\n"
         "Express execution order via depends-on-indices (0-based array indices).\n"
         "The graph MUST be a DAG — no cycles allowed.\n"
         "Every task must have at least one acceptance criterion and one CoVe verification question.\n"
         "Use the workspace UUID strings exactly as provided above.\n")))

;; -- Retry loop --------------------------------------------------------------

(def ^:private max-retries 3)

(defn- format-errors-for-retry
  "Format validation errors into a user message for the LLM retry."
  [errors]
  (str "Your previous response had validation errors. Fix them and try again:\n\n"
       (str/join "\n"
                 (map (fn [{:keys [type message]}]
                        (str "- [" (name type) "] " message))
                      errors))
       "\n\nReturn a corrected task graph."))

(defn- parse-workspace-ids
  "Convert string workspace-id values in specs to UUIDs."
  [specs]
  (mapv (fn [spec]
          (let [ws-id (:workspace-id spec)]
            (cond-> spec
              (string? ws-id) (assoc :workspace-id
                                     (try (java.util.UUID/fromString ws-id)
                                          (catch Exception _ ws-id))))))
        specs))

(defn decompose-ticket!
  "Decompose a ticket into a task dependency graph using Svar.

   Calls Svar ask! to generate a task graph spec, validates it with
   `task/validate-graph`, and retries with error feedback up to 3 times.
   On success, persists via `task/create-graph!`.

   Params:
   `conn`      - Datalevin connection.
   `ticket-id` - UUID. Ticket to decompose.
   `opts`      - Optional map:
     `:model`  - String. LLM model (default: from env / Svar config).
     `:config` - Map. Svar config from `svar/make-config`.

   Returns:
   Vector of created task maps with dependency edges."
  ([conn ticket-id] (decompose-ticket! conn ticket-id {}))
  ([conn ticket-id {:keys [model config]}]
   (let [ticket     (db.ticket/find-ticket conn ticket-id)
         _          (when-not ticket
                      (throw (ex-info "Ticket not found" {:ticket-id ticket-id})))
         org-id     (get-in ticket [:ticket/organization :organization/id])
         workspaces (db.organization/list-workspaces conn org-id)
         _          (when (empty? workspaces)
                      (throw (ex-info "Organization has no workspaces" {:organization-id org-id})))
         sys-prompt (build-system-prompt ticket workspaces)
         base-msgs  [(svar/system sys-prompt)
                     (svar/user "Decompose this ticket into tasks.")]
         ask-opts   (cond-> {:spec     graph-spec
                             :messages base-msgs}
                      model  (assoc :model model)
                      config (assoc :config config))]

     (loop [attempt 0
            messages base-msgs]
       (let [result    (svar/ask! (assoc ask-opts :messages messages))
             raw-specs (get-in result [:result :tasks] [])
             specs     (parse-workspace-ids raw-specs)
             validation (task/validate-graph specs)]

         (if (:valid validation)
           ;; Success — persist
           (task/create-graph! conn ticket-id specs)

           ;; Failure — retry or throw
           (if (>= attempt max-retries)
             (throw (ex-info (str "Failed to generate valid task graph after " (inc max-retries) " attempts")
                             {:type   :analysis-failed
                              :errors (:errors validation)
                              :ticket-id ticket-id}))
             (recur (inc attempt)
                    (conj messages
                          (svar/assistant (pr-str raw-specs))
                          (svar/user (format-errors-for-retry (:errors validation))))))))))))
