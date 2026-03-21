(ns com.blockether.styrmann.execution.agent-types
  "Definitions for the 5 Styrmann agent types.

   Each agent type has a key, name, type keyword, default model, role,
   system instructions, and tool bindings."
  (:require
   [clojure.string :as str]
   [com.blockether.styrmann.db.session :as db.session]))

(def agent-type-valid?
  "Set of valid agent type keywords."
  #{:agent.type/planner
    :agent.type/implementer
    :agent.type/reviewer
    :agent.type/explorer
    :agent.type/verifier})

(def ^:private agent-definitions
  [{:key "planner-v1"
    :name "Planner Agent"
    :type :agent.type/planner
    :model "glm-5"
    :version "0.1.0"
    :role "Decomposes tickets into task DAGs with acceptance criteria and dependency ordering"
    :instructions ["Analyze ticket description and acceptance criteria"
                   "Break work into smallest meaningful tasks"
                   "Assign each task to exactly one workspace"
                   "Express execution order via depends-on indices"
                   "Generate CoVe verification questions for each task"
                   "The graph MUST be a DAG — no cycles allowed"]
    :tool-keys ["ticket.find" "task.list-by-ticket"]}

   {:key "implementer-v1"
    :name "Implementer Agent"
    :type :agent.type/implementer
    :model "glm-5-turbo"
    :version "0.1.0"
    :role "Writes code using structured editing within workspace boundaries"
    :instructions ["Read and understand the task acceptance criteria"
                   "Use structured editing for all code changes"
                   "Run clojure-lsp diagnostics after edits"
                   "Write tests before implementation (TDD)"
                   "Commit only changes that pass all diagnostics"]
    :tool-keys ["ticket.find" "task.list-by-ticket" "explore.clojure-lsp-diagnostics" "explore.namespace-map"]}

   {:key "reviewer-v1"
    :name "Reviewer Agent"
    :type :agent.type/reviewer
    :model "glm-5"
    :version "0.1.0"
    :role "Reviews code changes for correctness, style, and test coverage"
    :instructions ["Check code against acceptance criteria"
                   "Run clojure-lsp diagnostics — zero errors required"
                   "Verify test coverage for changed functions"
                   "Flag security concerns and secret exposure"
                   "Approve or reject with specific feedback"]
    :tool-keys ["ticket.find" "task.list-by-ticket" "explore.clojure-lsp-diagnostics" "explore.namespace-map"]}

   {:key "explorer-v1"
    :name "Explorer Agent"
    :type :agent.type/explorer
    :model "glm-5-turbo"
    :version "0.1.0"
    :role "Explores and indexes Clojure codebases using clojure-lsp-backed tooling"
    :instructions ["Run clojure-lsp diagnostics for target codebase"
                   "Build namespace inventory and structural map"
                   "Report indexing readiness and blockers"]
    :tool-keys ["explore.clojure-lsp-diagnostics" "explore.namespace-map"]}

   {:key "verifier-v1"
    :name "Verifier Agent"
    :type :agent.type/verifier
    :model "glm-5-turbo"
    :version "0.1.0"
    :role "Runs tests, validates acceptance criteria, and confirms task completion"
    :instructions ["Run full test suite and report results"
                   "Validate each acceptance criterion is met"
                   "Answer CoVe verification questions with evidence"
                   "Check git status for uncommitted changes"
                   "Report pass/fail with specific evidence"]
    :tool-keys ["ticket.find" "task.list-by-ticket" "git.repo.summary" "explore.clojure-lsp-diagnostics"]}])

(defn ensure-all-agents!
  "Ensure all 5 agent types are registered in the database.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Vector of agent maps."
  [conn]
  (let [tools (db.session/list-tool-definitions conn)]
    (mapv (fn [{:keys [key name type model version role instructions tool-keys]}]
            (or (db.session/find-agent-by-key conn key)
                (let [tool-ids (->> tools
                                    (filter #(contains? (set tool-keys) (:tool-definition/key %)))
                                    (mapv :tool-definition/id))]
                  (db.session/create-agent!
                   conn
                   {:key key
                    :name name
                    :type type
                    :model model
                    :version version
                    :role role
                    :instructions-edn (pr-str instructions)
                    :tool-ids tool-ids}))))
          agent-definitions)))

(defn find-agent-by-type
  "Find the first agent matching a given type.

   Params:
   `conn` - Datalevin connection.
   `agent-type` - Keyword like :agent.type/planner.

   Returns:
   Agent map or nil."
  [conn agent-type]
  (when-not (agent-type-valid? agent-type)
    (throw (ex-info "Invalid agent type"
                    {:type agent-type
                     :valid (str/join ", " (map name agent-type-valid?))})))
  (let [agents (ensure-all-agents! conn)]
    (first (filter #(= agent-type (:agent/type %)) agents))))
