(ns com.blockether.styrmann.execution.context
  "Defines the execution context map contract.

   The context map (`ctx`) is passed to all execution functions instead of a
   raw Datalevin connection. Every key is a function — persistence callbacks
   under `:store/*` and domain-rule callbacks under `:domain/*`.

   Build a context from a live connection via
   `com.blockether.styrmann.domain.execution-context/make-context`.")

(def ^:private required-keys
  "All keys that MUST be present and be functions in a valid context."
  [;; -- store: persistence callbacks ------------------------------------------
   :store/find-task
   :store/find-workspace
   :store/find-environment-by-workspace
   :store/find-session
   :store/find-agent-by-key
   :store/create-environment!
   :store/create-workflow!
   :store/create-session!
   :store/create-session-event!
   :store/create-session-message!
   :store/create-tool-call!
   :store/create-agent!
   :store/finish-tool-call!
   :store/mark-session-finished!
   :store/mark-workflow-finished!
   :store/upsert-tool-definition!
   :store/list-tool-definitions
   :store/list-tool-calls-by-session
   :store/list-session-events
   :store/list-session-messages
   :store/list-sessions-by-task
   :store/list-environments-by-organization
   :store/update-environment-by-workspace!
   ;; git persistence
   :store/git-find-repo-by-workspace
   :store/git-list-commits-by-repo
   :store/git-list-branches-by-repo
   :store/git-create-repo!
   :store/git-upsert-author!
   :store/git-create-commit!
   :store/git-create-branch!
   :store/git-update-branch-head!
   :store/git-create-worktree!
   ;; -- domain: business-rule callbacks ---------------------------------------
   :domain/update-task-status!
   :domain/ready-dependents
   :domain/find-default-provider
   ;; -- domain: AC + deliverable operations (raw Datalog extracted) -----------
   :domain/verify-acceptance-criterion!
   :domain/record-deliverable!])

(defn validate-context!
  "Assert that `ctx` contains all required keys and that each value is a fn.

   Throws ex-info on the first missing or non-fn key."
  [ctx]
  (doseq [k required-keys]
    (let [v (get ctx k ::missing)]
      (when (= v ::missing)
        (throw (ex-info (str "Execution context missing key: " k)
                        {:key k})))
      (when-not (fn? v)
        (throw (ex-info (str "Execution context key is not a function: " k)
                        {:key k :value v}))))))
