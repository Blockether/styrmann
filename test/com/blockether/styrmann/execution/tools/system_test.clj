(ns com.blockether.styrmann.execution.tools.system-test
  "Integration tests for system tools: signal-event, record-deliverable,
   verify-acceptance-criterion, update-task-status.
   Uses real temp Datalevin instances."
  (:require
   [com.blockether.styrmann.db.session :as db.session]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.execution.tools.system :as sut]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [datalevin.core :as d]
   [lazytest.core :refer [defdescribe describe expect it]]))

(defn- throws-exception?
  "Returns true if calling f throws any Exception."
  [f]
  (try (f) false (catch Exception _ true)))

(defn- make-org-workspace-ticket [conn]
  (let [org (organization/create! conn {:name "TestOrg"})
        ws  (organization/create-workspace!
             conn
             {:organization-id (:organization/id org)
              :name "test-ws"
              :repository "/tmp/test-repo"})
        tkt (ticket/create!
             conn
             {:organization-id (:organization/id org)
              :type :ticket.type/feature
              :title "Feature ticket"
              :description "Feature description"
              :acceptance-criteria-text "- AC one\n- AC two"
              :story-points 2
              :effort 3
              :impact 7
              :assignee "dev"})]
    {:org org :workspace ws :ticket tkt}))

(defn- make-task [conn {:keys [ticket workspace]} ac-edn]
  (task/create!
   conn
   (cond-> {:ticket-id    (:ticket/id ticket)
            :workspace-id (:workspace/id workspace)
            :description  "Test task"}
     ac-edn (assoc :acceptance-criteria-edn ac-edn))))

(defn- make-minimal-session
  "Create a real session with a stub agent — needed by signal-event and verify-ac tests."
  [conn workspace task-id]
  (let [env   (db.session/create-environment!
               conn
               {:workspace-id      (:workspace/id workspace)
                :model             "test-model"
                :working-directory "/tmp"
                :status            :execution-environment.status/ready})
        agent (db.session/create-agent!
               conn
               {:key              "stub-agent"
                :name             "Stub Agent"
                :version          "0.0.1"
                :role             "stub"
                :instructions-edn (pr-str [])
                :tool-ids         []})
        wf    (db.session/create-workflow! conn {:task-id task-id})
        sess  (db.session/create-session!
               conn
               {:workflow-id       (:workflow/id wf)
                :environment-id    (:execution-environment/id env)
                :agent-id          (:agent/id agent)
                :pid               0
                :command-edn       "[]"
                :log-path          ""
                :exit-path         ""
                :working-directory "/tmp"})]
    sess))

;; ---------------------------------------------------------------------------
;; signal-event
;; ---------------------------------------------------------------------------

(defdescribe signal-event-test
  (describe "records a session event by type and message"
    (it "stores event and returns :ok? true"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace} nil)
              sess     (make-minimal-session conn workspace (:task/id task-rec))
              sid      (:session/id sess)
              result   (sut/signal-event
                        {:conn conn :session-id sid}
                        {:type "progress" :message "halfway done" :payload {:pct 50}})]
          (expect (= true (:ok? result)))
          (let [events (session/list-session-events conn sid)]
            (expect (= 1 (count events)))
            (expect (= :session.event.type/progress (:session.event/type (first events))))
            (expect (= "halfway done" (:session.event/message (first events))))))))

    (it "stores a second event type and returns :ok? true"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace} nil)
              sess     (make-minimal-session conn workspace (:task/id task-rec))
              sid      (:session/id sess)
              result   (sut/signal-event
                        {:conn conn :session-id sid}
                        {:type "complete" :message "done" :payload {:step 2}})]
          (expect (= true (:ok? result)))
          (let [events (session/list-session-events conn sid)]
            (expect (= 1 (count events)))
            (expect (= "done" (:session.event/message (first events))))))))))

;; ---------------------------------------------------------------------------
;; record-deliverable
;; ---------------------------------------------------------------------------

(defdescribe record-deliverable-test
  (describe "creates a new deliverable on a task"
    (it "appends deliverable and returns updated list"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace} nil)
              tid      (:task/id task-rec)
              result   (sut/record-deliverable
                        {:conn conn}
                        {:task-id     tid
                         :title       "Modal audit"
                         :description "Found 3 inconsistencies"
                         :status      "done"})]
          (expect (= true (:ok? result)))
          (expect (= 1 (count (:deliverables result))))
          (expect (= "Modal audit" (:title (first (:deliverables result)))))
          (expect (= "Found 3 inconsistencies" (:description (first (:deliverables result)))))
          (expect (= "done" (:status (first (:deliverables result))))))))

    (it "appends multiple distinct deliverables"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace} nil)
              tid      (:task/id task-rec)
              ctx      {:conn conn}]
          (sut/record-deliverable ctx {:task-id tid :title "First"  :description "D1" :status "pending"})
          (let [result (sut/record-deliverable ctx {:task-id tid :title "Second" :description "D2" :status "done"})]
            (expect (= true (:ok? result)))
            (expect (= 2 (count (:deliverables result))))
            (expect (= "First"  (:title (first  (:deliverables result)))))
            (expect (= "Second" (:title (second (:deliverables result)))))))))

    (it "updates existing deliverable by title — idempotent upsert"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace} nil)
              tid      (:task/id task-rec)
              ctx      {:conn conn}]
          (sut/record-deliverable ctx {:task-id tid :title "Report" :description "v1" :status "pending"})
          (let [result (sut/record-deliverable ctx {:task-id tid :title "Report" :description "v2 updated" :status "done"})]
            (expect (= true (:ok? result)))
            (expect (= 1 (count (:deliverables result))))
            (expect (= "v2 updated" (:description (first (:deliverables result)))))
            (expect (= "done" (:status (first (:deliverables result))))))))))

  (describe "validation"
    (it "throws when task-id does not exist"
      (with-temp-conn [conn (temp-conn)]
        (expect
         (throws-exception?
          #(sut/record-deliverable
            {:conn conn}
            {:task-id (java.util.UUID/randomUUID)
             :title "x" :description "y" :status "done"})))))

    (it "throws on invalid deliverable status"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace} nil)]
          (expect
           (throws-exception?
            #(sut/record-deliverable
              {:conn conn}
              {:task-id     (:task/id task-rec)
               :title       "x"
               :description "y"
               :status      "invalid-status"}))))))))

;; ---------------------------------------------------------------------------
;; verify-acceptance-criterion
;; ---------------------------------------------------------------------------

(defdescribe verify-acceptance-criterion-test
  (describe "marks an AC entity with verdict and reasoning"
    (it "returns :ok? true with criterion text and verdict"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace}
                                  "[\"AC one\" \"AC two\"]")
              tid      (:task/id task-rec)
              result   (sut/verify-acceptance-criterion
                        {:conn conn :session-id nil}
                        {:task-id   tid
                         :index     0
                         :verdict   "verified"
                         :reasoning "All checks passed"})]
          (expect (= true (:ok? result)))
          (expect (= "AC one"          (get-in result [:criterion :text])))
          (expect (= "verified"        (get-in result [:criterion :verdict])))
          (expect (= "All checks passed" (get-in result [:criterion :reasoning])))))

    (it "marks second AC at index 1"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace}
                                  "[\"First AC\" \"Second AC\"]")
              tid      (:task/id task-rec)
              result   (sut/verify-acceptance-criterion
                        {:conn conn :session-id nil}
                        {:task-id tid :index 1 :verdict "failed"
                         :reasoning "Test failed on edge case"})]
          (expect (= true (:ok? result)))
          (expect (= "Second AC" (get-in result [:criterion :text])))
          (expect (= "failed"    (get-in result [:criterion :verdict])))))

    (it "persists verdict to the database entity"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace}
                                  "[\"Verify me\"]")
              tid      (:task/id task-rec)]
          (sut/verify-acceptance-criterion
           {:conn conn :session-id nil}
           {:task-id tid :index 0 :verdict "skipped" :reasoning "out of scope"})
          (let [ac-eid (d/q '[:find ?e .
                               :in $ ?tid
                               :where
                               [?t :task/id ?tid]
                               [?e :task.ac/task ?t]
                               [?e :task.ac/index 0]]
                             (d/db conn) tid)
                ac     (d/pull (d/db conn) [:task.ac/verdict :task.ac/reasoning] ac-eid)]
            (expect (= :ac.status/skipped (:task.ac/verdict ac)))
            (expect (= "out of scope"     (:task.ac/reasoning ac)))))))))

  (describe "emits ac-verification session event when session-id is provided"
    (it "creates one event of type :session.event.type/ac-verification"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace}
                                  "[\"Check login\"]")
              tid      (:task/id task-rec)
              sess     (make-minimal-session conn workspace tid)
              sid      (:session/id sess)]
          (sut/verify-acceptance-criterion
           {:conn conn :session-id sid}
           {:task-id tid :index 0 :verdict "verified" :reasoning "looks good"})
          (let [events (session/list-session-events conn sid)]
            (expect (= 1 (count events)))
            (expect (= :session.event.type/ac-verification
                       (:session.event/type (first events)))))))))

  (describe "validation"
    (it "throws when verdict is invalid"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace}
                                  "[\"AC\"]")
              tid      (:task/id task-rec)]
          (expect
           (throws-exception?
            #(sut/verify-acceptance-criterion
              {:conn conn :session-id nil}
              {:task-id tid :index 0 :verdict "bogus" :reasoning "x"}))))))

    (it "throws when AC index does not exist"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace}
                                  "[\"Only one AC\"]")
              tid      (:task/id task-rec)]
          (expect
           (throws-exception?
            #(sut/verify-acceptance-criterion
              {:conn conn :session-id nil}
              {:task-id tid :index 5 :verdict "verified" :reasoning "x"}))))))

    (it "throws when task-id does not exist"
      (with-temp-conn [conn (temp-conn)]
        (expect
         (throws-exception?
          #(sut/verify-acceptance-criterion
            {:conn conn :session-id nil}
            {:task-id (java.util.UUID/randomUUID)
             :index 0 :verdict "verified" :reasoning "x"}))))))))

;; ---------------------------------------------------------------------------
;; update-task-status
;; ---------------------------------------------------------------------------

(defdescribe update-task-status-test
  (describe "advances task to a valid next status"
    (it "transitions inbox -> implementing and returns :ok? true"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace} nil)
              tid      (:task/id task-rec)
              result   (sut/update-task-status
                        {:conn conn}
                        {:task-id (str tid) :status "implementing"})]
          (expect (= true (:ok? result)))
          (expect (= (str tid) (:task-id result)))
          (expect (= "implementing" (:status result))))))

    (it "transitions implementing -> testing"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace} nil)
              tid      (:task/id task-rec)]
          (sut/update-task-status {:conn conn} {:task-id (str tid) :status "implementing"})
          (let [result (sut/update-task-status {:conn conn} {:task-id (str tid) :status "testing"})]
            (expect (= true (:ok? result)))
            (expect (= "testing" (:status result))))))))

  (describe "rejects invalid status strings"
    (it "throws for unknown status"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace} nil)
              tid      (:task/id task-rec)]
          (expect
           (throws-exception?
            #(sut/update-task-status
              {:conn conn}
              {:task-id (str tid) :status "flying"})))))))

  (describe "rejects invalid status transitions"
    (it "throws when jumping inbox -> done directly"
      (with-temp-conn [conn (temp-conn)]
        (let [{:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec (make-task conn {:ticket ticket :workspace workspace} nil)
              tid      (:task/id task-rec)]
          (expect
           (throws-exception?
            #(sut/update-task-status
              {:conn conn}
              {:task-id (str tid) :status "done"}))))))))
