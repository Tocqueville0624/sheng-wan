const repository = "https://github.com/Tocqueville0624/product-search-quality";
const revision = "1ffadcd222b46dd91c3a0cd4366c658e099fcec5";
const evidence = `${repository}/blob/${revision}`;

// Aggregate results from reports/test_metrics.json and reports/data_audit.json
// at the pinned revision. No examples, predictions or source data are republished.
export const searchQualityProject = {
  repository,
  revision,
  datasetSource:
    "https://github.com/amazon-science/esci-data/tree/7916cdf6ab75a462e77f20ab40428a10923998d5",
  title: "Product Search Quality Analysis",
  description:
    "A reproducible PySpark study of product relevance and review prioritization: 1.82 million public query–product judgments, fixed-budget evaluation and explicit model limitations.",
  sourcePairs: 1818825,
  testPairs: 425762,
  testQueries: 22458,
  poolSize: 199989,
  poolErrors: 39729,
  poolCoverage: 0.46972017230283586,
  randomYield: 0.19865592607593419,
  yieldDifference: 0.13012695221189458,
  differenceInterval: [0.12112375496395941, 0.14011561460697886],
  bootstrapReplicates: 300,
  complementPrecision: 0.04174125585238227,
  partitions: [
    { name: "Training", pairs: 1113987, queries: 59947 },
    { name: "Validation", pairs: 279073, queries: 14940 },
    { name: "Official test", pairs: 425762, queries: 22458 }
  ],
  sources: [
    {
      title: "Source code and reproduction",
      href: `${evidence}/README.md`,
      detail: "Run the study locally with pinned data and dependencies."
    },
    {
      title: "Complete test results",
      href: `${evidence}/reports/test_metrics.json`,
      detail: "Class metrics, review budgets, query slices and uncertainty intervals."
    },
    {
      title: "Data and split audit",
      href: `${evidence}/reports/data_audit.json`,
      detail: "Input counts, row-preserving joins and disjoint query partitions."
    },
    {
      title: "Product decision memo",
      href: `${evidence}/reports/product-decision-memo.md`,
      detail: "Operational interpretation, limits and the proposed human-review pilot."
    }
  ]
};

export const searchQualityBudgets = [
  {
    percent: 10,
    inspected: 19998,
    priorityErrors: 6575,
    randomExpectedErrors: 3972.7212096665316,
    priorityYield: 0.32878287828782876,
    errorRecall: 0.1654962370057137,
    remainingErrors: 33154
  },
  {
    percent: 5,
    inspected: 9999,
    priorityErrors: 3386,
    randomExpectedErrors: 1986.3606048332658,
    priorityYield: 0.3386338633863386,
    errorRecall: 0.08522741574164967,
    remainingErrors: 36343
  }
];

export const searchQualityTradeoffs = [
  {
    title: "Macro-F1",
    unit: "Score from 0 to 1 · higher is better",
    baseline: 0.19722945200608724,
    model: 0.33339245245166044,
    ticks: ["0", "0.25", "0.50", "0.75", "1.00"],
    percent: false,
    explanation:
      "F1 balances precision and recall. Macro-F1 gives each of the four classes equal weight, so recognizing minority classes matters as much as recognizing Exact matches."
  },
  {
    title: "Accuracy",
    unit: "Correct predictions out of all test pairs · higher is better",
    baseline: 0.6514155795961124,
    model: 0.48821407265091765,
    ticks: ["0%", "25%", "50%", "75%", "100%"],
    percent: true,
    explanation:
      "The majority baseline predicts Exact for every pair. It gets more individual predictions right because Exact dominates the data. The selected model sacrifices accuracy for broader class recognition."
  }
];
