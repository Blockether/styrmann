(ns com.blockether.styrmann.runner.tools-test
  (:require
   [com.blockether.styrmann.db.git :as db.git]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.runner.tool-registry :as registry]
   [com.blockether.styrmann.runner.tools.git :as tools.git]
   [com.blockether.styrmann.runner.tools.task :as tools.task]
   [com.blockether.styrmann.runner.tools.ticket :as tools.ticket]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe describe expect it]]))

(defn- setup-org-ticket [conn]
  (let [org (organization/create! conn {:name "TestOrg"})
        ws (organization/create-workspace!
            conn
            {:organization-id (:organization/id org)
             :name "test-repo"
             :repository "/tmp/test-repo"})
        tkt (ticket/create!
             conn
             {:organization-id (:organization/id org)
              :type :ticket.type/feature
              :title "Build login page"
              :description "Implement OAuth login"
              :acceptance-criteria-text "- OAuth flow works"
              :story-points 3
              :effort 5
              :impact 8
              :assignee "dev1"})]
    {:org org :workspace ws :ticket tkt}))

(defdescribe ticket-find-test
  (describe "tools.ticket/find-ticket"
    (it "finds a ticket by id and returns serializable map"
        (with-temp-conn [conn (temp-conn)]
          (let [{:keys [ticket]} (setup-org-ticket conn)
                result (tools.ticket/find-ticket
                        {:conn conn}
                        {:ticket-id (str (:ticket/id ticket))})]
            (expect (= true (:ok? result)))
            (expect (= "Build login page" (get-in result [:ticket :ticket/title])))
            (expect (= "feature" (get-in result [:ticket :ticket/type]))))))

    (it "returns error for non-existent ticket"
        (with-temp-conn [conn (temp-conn)]
          (let [result (tools.ticket/find-ticket
                        {:conn conn}
                        {:ticket-id (str (java.util.UUID/randomUUID))})]
            (expect (= false (:ok? result)))
            (expect (some? (:error result))))))))

(defdescribe task-list-by-ticket-test
  (describe "tools.task/list-by-ticket"
    (it "lists tasks for a ticket"
        (with-temp-conn [conn (temp-conn)]
          (let [{:keys [ticket workspace]} (setup-org-ticket conn)
                _ (task/create! conn {:ticket-id (:ticket/id ticket)
                                      :workspace-id (:workspace/id workspace)
                                      :description "Setup OAuth provider"})
                _ (task/create! conn {:ticket-id (:ticket/id ticket)
                                      :workspace-id (:workspace/id workspace)
                                      :description "Build login UI"})
                result (tools.task/list-by-ticket
                        {:conn conn}
                        {:ticket-id (str (:ticket/id ticket))})]
            (expect (= true (:ok? result)))
            (expect (= 2 (:count result)))
            (expect (= #{"Setup OAuth provider" "Build login UI"}
                       (set (map :task/description (:tasks result))))))))))

(defdescribe git-repo-summary-test
  (describe "tools.git/repo-summary"
    (it "returns workspace info even without git repo"
        (with-temp-conn [conn (temp-conn)]
          (let [{:keys [workspace]} (setup-org-ticket conn)
                result (tools.git/repo-summary
                        {:conn conn}
                        {:workspace-id (str (:workspace/id workspace))})]
            (expect (= true (:ok? result)))
            (expect (= "test-repo" (get-in result [:workspace :name])))
            (expect (nil? (:repo result))))))

    (it "returns repo with branches and commits when git data exists"
        (with-temp-conn [conn (temp-conn)]
          (let [{:keys [workspace]} (setup-org-ticket conn)
                repo (db.git/create-repo!
                      conn
                      {:workspace-id (:workspace/id workspace)
                       :origin-url "git@github.com:test/repo.git"
                       :default-branch "main"})
                branch (db.git/create-branch!
                        conn
                        {:repo-id (:git.repo/id repo)
                         :name "main"})
                author (db.git/upsert-author! conn {:name "Dev" :email "dev@test.com"})
                commit (db.git/create-commit!
                        conn
                        {:repo-id (:git.repo/id repo)
                         :sha "abc123"
                         :message "Initial commit"
                         :author-id (:git.author/id author)
                         :authored-at (java.util.Date.)
                         :parent-ids []})
                _ (db.git/update-branch-head! conn (:git.branch/id branch) (:git.commit/id commit))
                result (tools.git/repo-summary
                        {:conn conn}
                        {:workspace-id (str (:workspace/id workspace))})]
            (expect (= true (:ok? result)))
            (expect (some? (:repo result)))
            (expect (= 1 (:branch-count result)))
            (expect (= 1 (:commit-count result)))
            (expect (= "abc123" (get-in result [:recent-commits 0 :sha]))))))))

(defdescribe registry-resolve-test
  (describe "tool registry resolves all default tools"
    (it "all default tool fn-symbols resolve without error"
        (registry/register-default-tools!)
        (let [tools     (registry/list-tools)
              fn-symbols (set (map :fn-symbol tools))]
          ;; 22 tools: filesystem (5), structural-edit (5), spel (2), system (4), explore (2), ticket (1), task (1), git (1), ticket-runner (1)
          (expect (= 22 (count tools)))
          (doseq [tool tools]
            (expect (some? (requiring-resolve (symbol (:fn-symbol tool))))))
          ;; Spot-check key tool fn-symbols are present
          (expect (contains? fn-symbols "com.blockether.styrmann.execution.tools.filesystem/read-file"))
          (expect (contains? fn-symbols "com.blockether.styrmann.execution.tools.filesystem/write-file"))
          (expect (contains? fn-symbols "com.blockether.styrmann.execution.tools.system/signal-event"))
          (expect (contains? fn-symbols "com.blockether.styrmann.runner.tools.ticket/find-ticket"))))))
