(ns com.blockether.styrmann.domain.analysis-test
  (:require
   [clojure.edn :as edn]
   [com.blockether.styrmann.domain.analysis :as sut]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe describe expect it]]
   [matcher-combinators.matchers :as m]
   [matcher-combinators.standalone :as mc]))

(defn- setup-org-with-workspaces
  "Create an organization with two workspaces. Returns [org ws-backend ws-frontend]."
  [conn]
  (let [org      (organization/create! conn {:name "Blockether"})
        org-id   (:organization/id org)
        ws-back  (organization/create-workspace!
                  conn
                  {:organization-id org-id
                   :name            "styrmann"
                   :repository      "/root/repos/blockether/styrmann"})
        ws-front (organization/create-workspace!
                  conn
                  {:organization-id org-id
                   :name            "unbound-ui"
                   :repository      "/root/repos/blockether/unbound-ui"})]
    [org ws-back ws-front]))

(def ^:private task-matcher
  "Matcher for a single well-formed task from decomposition."
  (m/embeds {:task/status                  :task.status/inbox
             :task/description             string?
             :task/acceptance-criteria-edn string?
             :task/cove-questions-edn      string?
             :task/workspace               (m/embeds {:workspace/id uuid?})}))

(defdescribe decompose-ticket!-test
  (describe "end-to-end Svar integration"
            (it "decomposes a ticket into a valid task DAG with acceptance criteria and CoVe questions"
                (with-temp-conn [conn (temp-conn)]
                  (let [[org _ _]  (setup-org-with-workspaces conn)
                        tkt        (ticket/create!
                                    conn
                                    {:organization-id        (:organization/id org)
                                     :type                   :ticket.type/feature
                                     :title                  "Add JWT authentication"
                                     :description            "Implement JWT-based auth for the REST API. Users log in with email/password and receive a JWT. Protected routes validate tokens. Include a refresh endpoint."
                                     :acceptance-criteria-text "- Login endpoint returns JWT on valid credentials\n- Protected routes reject invalid tokens with 401\n- Token refresh endpoint issues new access token\n- Passwords hashed with bcrypt"
                                     :story-points           8
                                     :effort                 7
                                     :impact                 9
                                     :assignee               "alex"})
                        tasks      (sut/decompose-ticket! conn (:ticket/id tkt)
                                                          {:model "gpt-4o-mini"})]

            ;; Every task matches the required structure
                    (expect (mc/match? (m/seq-of task-matcher) tasks))

            ;; Acceptance criteria round-trip as non-empty EDN vectors of strings
                    (doseq [t tasks]
                      (let [acs (edn/read-string (:task/acceptance-criteria-edn t))]
                        (expect (mc/match? (m/seq-of string?) acs))))

            ;; CoVe questions round-trip as non-empty EDN vectors of strings
                    (doseq [t tasks]
                      (let [qs (edn/read-string (:task/cove-questions-edn t))]
                        (expect (mc/match? (m/seq-of string?) qs))))

            ;; The persisted graph matches the returned tasks
                    (let [graph (task/dependency-graph conn (:ticket/id tkt))]
                      (expect (= (count tasks) (count graph)))))))))
