(ns com.blockether.styrmann.domain.provider-test
  (:require
   [com.blockether.styrmann.domain.provider :as sut]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe expect it]]))

(defdescribe create!-test
  (it "creates a provider with name, base-url, and api-key"
      (with-temp-conn [conn (temp-conn)]
        (let [provider (sut/add-provider! conn {:name "OpenAI"
                                                :base-url "https://api.openai.com/v1"
                                                :api-key "sk-test123"})]
          (expect (= "OpenAI" (:provider/name provider)))
          (expect (= "https://api.openai.com/v1" (:provider/base-url provider)))
          (expect (= "sk-test123" (:provider/api-key provider)))
          (expect (= false (:provider/default? provider)))))))

(defdescribe create-with-default-test
  (it "marks a provider as default when specified"
      (with-temp-conn [conn (temp-conn)]
        (let [provider (sut/add-provider! conn {:name "OpenAI"
                                                :base-url "https://api.openai.com/v1"
                                                :api-key "sk-test123"
                                                :default? true})]
          (expect (= true (:provider/default? provider)))
          (expect (= (:provider/id provider)
                     (:provider/id (sut/get-default-provider conn))))))))

(defdescribe list-providers-test
  (it "lists all providers sorted by default first"
      (with-temp-conn [conn (temp-conn)]
        (let [_ (sut/add-provider! conn {:name "Second" :base-url "http://b" :api-key "key2"})
              _ (sut/add-provider! conn {:name "First" :base-url "http://a" :api-key "key1" :default? true})]
          (expect (= 2 (count (sut/list-providers conn))))
          (expect (= "First" (:provider/name (first (sut/list-providers conn)))))))))

(defdescribe default-test
  (it "only one provider is default at a time"
      (with-temp-conn [conn (temp-conn)]
        (let [p1 (sut/add-provider! conn {:name "First" :base-url "http://a" :api-key "key1" :default? true})
              p2 (sut/add-provider! conn {:name "Second" :base-url "http://b" :api-key "key2" :default? true})]
          (expect (= true (:provider/default? p2)))
          (expect (= false (:provider/default? (sut/get-provider conn (:provider/id p1)))))
          (expect (= (:provider/id p2) (:provider/id (sut/get-default-provider conn))))))))

(defdescribe update!-test
  (it "updates provider name and base-url"
      (with-temp-conn [conn (temp-conn)]
        (let [provider (sut/add-provider! conn {:name "Old" :base-url "http://old" :api-key "key"})
              updated (sut/update-provider! conn (:provider/id provider) {:name "New" :base-url "http://new"})]
          (expect (= "New" (:provider/name updated)))
          (expect (= "http://new" (:provider/base-url updated)))))))
