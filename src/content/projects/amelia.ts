const repository = "https://github.com/Tocqueville0624/amelia-torch";
const revision = "810591e6a77956a49dfef5de1d4a2274fefe9e07";
const evidence = `${repository}/blob/${revision}/docs/validation`;

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
      value: "1.21–1.91×",
      label: "Native CUDA64 speedup",
      detail: "Against native CPU64 on the same T4 host"
    },
    {
      value: "100,000",
      label: "Rows per benchmark input",
      detail: "Three public datasets, 7–90 numeric variables"
    },
    {
      value: "Python + R",
      label: "Connected research workflows",
      detail: "Reference, compatibility and native interfaces"
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
};

// Published medians only. Routes, hosts and precision remain separate.
// T4 native values: native-timings-plotted-data.csv, rows 8–10 and 14–16.
// Hybrid and MPS values: their linked, archived benchmark tables.
export const ameliaBenchmarks: AmeliaBenchmark[] = [
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
