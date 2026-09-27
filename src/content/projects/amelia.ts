import rtx3080 from "@/data/generated/amelia-rtx3080.json";

const repository = "https://github.com/Tocqueville0624/amelia-torch";
const revision = rtx3080.evidenceRevision;
const evidence = `${repository}/blob/${revision}/docs/validation`;
const rtxEvidence = `${evidence}/2026-09-27-windows-rtx3080`;

export const ameliaProject = {
  repository,
  revision,
  title: "amelia-torch",
  subtitle: "Multiple imputation across Python, R and GPUs",
  description:
    "An experimental Python and R implementation of Amelia’s bootstrap–EM workflow, with reproducible comparisons across CPUs, NVIDIA CUDA and Apple GPUs.",
  lede: "Missing data makes research harder. This project asks whether modern tensor libraries can make multiple imputation faster to repeat, while preserving the statistical workflow that researchers already use.",
  metrics: [
    {
      value: "1.49×",
      label: "RTX 3080 · Native CUDA64 gain",
      detail: "90-variable task, against native CPU64 on the same host"
    },
    {
      value: "100,000",
      label: "Rows per benchmark input",
      detail: "Three public datasets, 7–90 numeric variables"
    },
    {
      value: "30",
      label: "RTX 3080 configurations audited",
      detail: "210 calls and 1,050 imputations, including warmups"
    }
  ],
  routes: [
    {
      title: "Original reference",
      body: "Call unmodified Amelia 1.8.3 from Python or R. This CPU route provides the comparison baseline and does not require PyTorch."
    },
    {
      title: "R compatibility",
      body: "Keep original R preprocessing, bootstrap, random draws and output objects. Replace the EM calculation with PyTorch on an explicitly selected device."
    },
    {
      title: "Native Python",
      body: "Run the continuous numeric workflow through NumPy and PyTorch. This narrower implementation has its own output structure and rejects unsupported options."
    }
  ],
  sources: [
    {
      title: "Complete RTX 3080 benchmark",
      href: `${rtxEvidence}/README.md`,
      detail:
        "September 27: all 30 Windows configurations, both precisions, timing dispersion and audit records."
    },
    {
      title: "Source code and setup",
      href: repository,
      detail: "Python and R interfaces, examples, tests and GPL-3.0-only license."
    },
    {
      title: "Complete T4 native benchmark",
      href: `${evidence}/2026-09-26-colab-native/README.md`,
      detail:
        "All 18 configurations, repeated timings, input hashes, environment and archived reports."
    },
    {
      title: "Partial T4 compatibility benchmark",
      href: `${evidence}/2026-09-26-colab-hybrid-partial/README.md`,
      detail: "The 11 recovered configurations and the explicitly missing twelfth result."
    },
    {
      title: "Mac benchmark and validation",
      href: `${evidence}/2026-09-23-development/README.md`,
      detail: "CPU and MPS comparisons, numerical checks and measured source snapshots."
    },
    {
      title: "Statistical inference study",
      href: `${evidence}/2026-09-26-g5-mps/README.md`,
      detail: "Prespecified criteria, Monte Carlo uncertainty and retained failures."
    },
    {
      title: "RTX 3080 paired-output comparison",
      href: `${rtxEvidence}/paired-reference.json`,
      detail:
        "Matched hybrid/reference inputs and seeds; output differences, not a claim of equivalence."
    },
    {
      title: "Compatibility and algorithm contract",
      href: `${repository}/blob/${revision}/docs/algorithm-contract.md`,
      detail: "The mathematical steps, upstream semantics and boundaries of the implementation."
    }
  ]
};

export type AmeliaBenchmark = {
  id: string;
  label: string;
  title: string;
  description: string;
  methods: string[];
  datasets: { name: string; variables: number; seconds: number[]; finding: string }[];
  caption: string;
  limitation: string;
  source: string;
  timingTable?: {
    caption: string;
    methods: string[];
    datasets: { name: string; seconds: number[]; iqrs: number[][] }[];
    note: string;
  };
};

const nativeMethods = ["r_serial", "r_snow4", "cpu64", "cuda64", "cpu32", "cuda32"] as const;
const hybridMethods = ["cpu64", "cuda64", "cpu32", "cuda32"] as const;
const rtxConditions =
  "Windows 11 / Ryzen 5 5600X / RTX 3080 (10 GiB); four Torch/BLAS threads. Inputs contain 100,000 rows. Medians of five measured calls after two warmups; five imputations per call. Python 3.12.14, PyTorch 2.14.0 / CUDA 13.2, R 4.5.3, Amelia 1.8.3; TF32 disabled.";

// Published medians only. Routes, hosts and precision remain separate.
// T4 native values: native-timings-plotted-data.csv, rows 8–10 and 14–16.
// Hybrid and MPS values: their linked, archived benchmark tables.
export const ameliaBenchmarks: AmeliaBenchmark[] = [
  {
    id: "rtx-native",
    label: "RTX 3080 · Native Python · float64",
    title: "The latest run: a gain on the 90-variable task",
    description:
      "On the RTX 3080 host, native CUDA64 reduced YearPredictionMSD from 32.979 to 22.115 seconds per call. The smaller inputs showed a modest gain or a slowdown; these three different datasets do not establish a scaling law.",
    methods: ["CPU64", "CUDA64"],
    datasets: rtx3080.datasets.map((dataset, index) => ({
      name: dataset.name,
      variables: dataset.variables,
      seconds: [dataset.native.cpu64.medianSeconds, dataset.native.cuda64.medianSeconds],
      finding: ["1.11× faster with CUDA", "CUDA takes 4% longer", "1.49× faster with CUDA"][index]!
    })),
    caption: `${rtxConditions} Native timing includes preparation, bootstrap, EM, draws, transfers and synchronization, ending with completed NumPy arrays on CPU.`,
    limitation:
      "September 27, 2026. Complete native/reference suite: 18 configurations. Block-MCAR inputs have 7–8 missingness patterns and 28.57–30% artificial missingness. Native supports fewer statistical options than full Amelia. Host, software and thread differences prevent attributing a T4/RTX timing gap to the GPU alone.",
    source: `${rtxEvidence}/README.md`,
    timingTable: {
      caption: "RTX 3080 · All 18 native/reference configurations · median seconds [Q1–Q3]",
      methods: ["R serial", "Original R ×4", "CPU64", "CUDA64", "CPU32", "CUDA32"],
      datasets: rtx3080.datasets.map((dataset) => ({
        name: dataset.name,
        seconds: nativeMethods.map((method) => dataset.native[method].medianSeconds),
        iqrs: nativeMethods.map((method) => dataset.native[method].iqrSeconds)
      })),
      note: "Original R ×4 uses four workers with one BLAS thread each. On the 90-variable input, serial R took 10.43× as long as native CUDA64, but that difference includes implementation, library and workflow differences; the same-route GPU gain is 1.49×. CPU32/CUDA32 gives 1.31× on that input. Bracketed ranges describe the middle half of five timings, not confidence intervals."
    }
  },
  {
    id: "rtx-hybrid",
    label: "RTX 3080 · R compatibility · float64",
    title: "A smaller gain through the complete R interface",
    description:
      "For the 90-variable task, hybrid CUDA64 reduced the complete R call from 110.620 to 101.640 seconds. Four-worker original Amelia took 121.730 seconds. CUDA made the two narrower compatibility tasks slower than their CPU equivalents.",
    methods: ["Original R ×4", "Hybrid CPU64", "Hybrid CUDA64"],
    datasets: rtx3080.datasets.map((dataset, index) => ({
      name: dataset.name,
      variables: dataset.variables,
      seconds: [
        dataset.native.r_snow4.medianSeconds,
        dataset.hybrid.cpu64.medianSeconds,
        dataset.hybrid.cuda64.medianSeconds
      ],
      finding: [
        "CUDA takes 7% longer than hybrid CPU",
        "CUDA takes 6% longer than hybrid CPU",
        "1.09× faster than hybrid CPU"
      ][index]!
    })),
    caption: `${rtxConditions} Compatibility timing includes R preparation, bootstrap, draws, postprocessing, bridging and transfers. Hybrid imputations run serially; original R uses four workers with one BLAS thread each.`,
    limitation:
      "Complete compatibility suite: 12 configurations. Native/reference and hybrid batches ran at different times; system load and temperature were not fully isolated. Subtracting native time from hybrid time does not measure communication overhead. Stage-level profiling and full CUDA inference validation remain unfinished.",
    source: `${rtxEvidence}/README.md`,
    timingTable: {
      caption: "RTX 3080 · All 12 R compatibility configurations · median seconds [Q1–Q3]",
      methods: ["Hybrid CPU64", "Hybrid CUDA64", "Hybrid CPU32", "Hybrid CUDA32"],
      datasets: rtx3080.datasets.map((dataset) => ({
        name: dataset.name,
        seconds: hybridMethods.map((method) => dataset.hybrid[method].medianSeconds),
        iqrs: hybridMethods.map((method) => dataset.hybrid[method].iqrSeconds)
      })),
      note: "Both precisions retain R stages outside EM. On the 90-variable task, CPU32/CUDA32 gave a 1.05× gain. Bracketed ranges are interquartile ranges over five measured calls, not confidence intervals or evidence of statistically significant timing differences."
    }
  },
  {
    id: "native-cuda",
    label: "NVIDIA T4 · Native Python · float64",
    title: "A measurable gain in the native workflow",
    description:
      "CUDA reduced the median time on all three inputs compared with the same native implementation on the same host’s CPU.",
    methods: ["CPU64", "CUDA64"],
    datasets: [
      {
        name: "Covertype",
        variables: 10,
        seconds: [9.87033728400002, 6.17157829600001],
        finding: "1.60× faster with CUDA"
      },
      {
        name: "Household power",
        variables: 7,
        seconds: [5.59240659499983, 4.61570725499996],
        finding: "1.21× faster with CUDA"
      },
      {
        name: "YearPredictionMSD",
        variables: 90,
        seconds: [80.3259469570003, 42.049474376],
        finding: "1.91× faster with CUDA"
      }
    ],
    caption:
      "Colab Linux / Tesla T4; two CPU threads. Each input has 100,000 rows. Medians of five measured calls after two warmups; five imputations per call. Timing includes preprocessing, bootstrap, imputation and device transfers, ending with completed NumPy arrays.",
    limitation:
      "These inputs use 7–8 block-missingness patterns with approximately 29–30% artificial missingness. This continuous-data route has a narrower scope than full Amelia. Speed ratios compare medians; they are not confidence intervals or a guarantee for other workloads.",
    source: `${evidence}/2026-09-26-colab-native/README.md`
  },
  {
    id: "hybrid-cuda",
    label: "NVIDIA T4 · R compatibility · float64",
    title: "The full R call changes the comparison",
    description:
      "CUDA improved these compatibility-route timings, but original Amelia with two R workers was faster than every saved CUDA configuration, including the float32 results in the report.",
    methods: ["Original R ×2", "Hybrid CPU64", "Hybrid CUDA64"],
    datasets: [
      {
        name: "Covertype",
        variables: 10,
        seconds: [20.827, 32.198, 24.776],
        finding: "Original R ×2 remains faster"
      },
      {
        name: "Household power",
        variables: 7,
        seconds: [14.649, 21.808, 16.782],
        finding: "Original R ×2 remains faster"
      },
      {
        name: "YearPredictionMSD",
        variables: 90,
        seconds: [175.359, 250.898, 178.274],
        finding: "Original R ×2 remains faster"
      }
    ],
    caption:
      "Same T4 runtime and prepared inputs as the native study. Medians of five calls after two warmups; five imputations per call. Compatibility timing includes R preprocessing, bootstrap, draws, postprocessing, the R/Python bridge and transfers. Original R uses two workers, each with one BLAS thread.",
    limitation:
      "Partial evidence: 11 of 12 configurations were recovered before the runtime was lost. YearPredictionMSD CUDA32 is unknown. Reference and compatibility runs occurred in separate batches; background load was not fully isolated. No replacement-runtime measurements are inserted into this batch.",
    source: `${evidence}/2026-09-26-colab-hybrid-partial/README.md`
  },
  {
    id: "native-mps",
    label: "Apple M4 · Native Python · float32",
    title: "Apple GPU acceleration did not pay off here",
    description:
      "On the tested M4 Mac, native MPS took approximately 51–70% longer than native CPU at the same precision. Slower results remain part of the project’s evidence.",
    methods: ["CPU32", "MPS32"],
    datasets: [
      {
        name: "Covertype",
        variables: 10,
        seconds: [1.895, 3.225],
        finding: "MPS takes 70% longer"
      },
      {
        name: "Household power",
        variables: 7,
        seconds: [1.478, 2.232],
        finding: "MPS takes 51% longer"
      },
      {
        name: "YearPredictionMSD",
        variables: 90,
        seconds: [12.089, 20.267],
        finding: "MPS takes 68% longer"
      }
    ],
    caption:
      "Apple M4 / 16 GB Mac, native continuous-data route; four CPU threads configured. Each input has 100,000 rows. Medians of five calls after two warmups; five imputations per call. CPU and MPS both use float32. These times are not compared with the separate T4 host to calculate a speedup.",
    limitation:
      "MPS requires explicit float32; CPU64 remains the default. Eigenvalue diagnostics still run on CPU. The R compatibility route was also slower on MPS than on its same-precision CPU route. These results do not establish the cause of the slowdown or predict every Apple GPU workload.",
    source: `${evidence}/2026-09-23-development/README.md`
  }
];
