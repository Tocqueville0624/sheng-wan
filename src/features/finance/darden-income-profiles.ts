import type { DardenBusinessProfile } from "./darden-source";

/** Finite layouts independently checked in the original complete primary statements.
 * Financial amounts remain in the source evidence, never in these meanings. */
export const dardenIncomeProfiles: readonly DardenBusinessProfile[] = [
  {
    id: "dri-original-primary-layout-1",
    rows: [
      {
        label: "Sales",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      },
      {
        label: "Food and beverage",
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        dimensions: {
          "srt:ProductOrServiceAxis": "us-gaap:FoodAndBeverageMember"
        }
      },
      {
        label: "Restaurant labor",
        tag: "us-gaap:CostDirectLabor",
        dimensions: {}
      },
      {
        label: "Restaurant expenses",
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        dimensions: {
          "srt:ProductOrServiceAxis": "us-gaap:ServiceOtherMember"
        }
      },
      {
        label: "Marketing expenses",
        tag: "us-gaap:MarketingExpense",
        dimensions: {}
      },
      {
        label: "Pre-opening costs",
        tag: "us-gaap:PreOpeningCosts",
        dimensions: {}
      },
      {
        label: "General and administrative expenses",
        tag: "us-gaap:GeneralAndAdministrativeExpense",
        dimensions: {}
      },
      {
        label: "Depreciation and amortization",
        tag: "us-gaap:DepreciationDepletionAndAmortization",
        dimensions: {}
      },
      {
        label: "Impairments and (gain) loss on disposal of assets, net",
        tag: "us-gaap:GainLossOnSalesOfAssetsAndAssetImpairmentCharges",
        dimensions: {}
      },
      {
        label: "Total operating costs and expenses",
        tag: "us-gaap:CostsAndExpenses",
        dimensions: {}
      },
      {
        label: "Operating income",
        tag: "us-gaap:OperatingIncomeLoss",
        dimensions: {}
      },
      {
        label: "Interest, net",
        tag: "us-gaap:InterestIncomeExpenseNonoperatingNet",
        dimensions: {}
      },
      {
        label: "Earnings before income taxes",
        tag: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        dimensions: {}
      },
      {
        label: "Income tax expense",
        tag: "us-gaap:IncomeTaxExpenseBenefit",
        dimensions: {}
      },
      {
        label: "Earnings from continuing operations",
        tag: "us-gaap:IncomeLossFromContinuingOperations",
        dimensions: {}
      },
      {
        label: "Losses from discontinued operations, net of original reported tax benefits",
        tag: "us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTax",
        dimensions: {}
      },
      {
        label: "Net earnings",
        tag: "us-gaap:NetIncomeLoss",
        dimensions: {}
      }
    ]
  },
  {
    id: "dri-original-primary-layout-2",
    rows: [
      {
        label: "Sales",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      },
      {
        label: "Food and beverage",
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        dimensions: {
          "srt:ProductOrServiceAxis": "us-gaap:FoodAndBeverageMember"
        }
      },
      {
        label: "Restaurant labor",
        tag: "us-gaap:CostDirectLabor",
        dimensions: {}
      },
      {
        label: "Restaurant expenses",
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        dimensions: {
          "srt:ProductOrServiceAxis": "us-gaap:ServiceOtherMember"
        }
      },
      {
        label: "Marketing expenses",
        tag: "us-gaap:MarketingExpense",
        dimensions: {}
      },
      {
        label: "Pre-opening costs",
        tag: "us-gaap:PreOpeningCosts",
        dimensions: {}
      },
      {
        label: "General and administrative expenses",
        tag: "us-gaap:GeneralAndAdministrativeExpense",
        dimensions: {}
      },
      {
        label: "Depreciation and amortization",
        tag: "us-gaap:DepreciationDepletionAndAmortization",
        dimensions: {}
      },
      {
        label: "Impairments and disposal of assets, net",
        tag: "us-gaap:GainLossOnSalesOfAssetsAndAssetImpairmentCharges",
        dimensions: {}
      },
      {
        label: "Total operating costs and expenses",
        tag: "us-gaap:CostsAndExpenses",
        dimensions: {}
      },
      {
        label: "Operating income",
        tag: "us-gaap:OperatingIncomeLoss",
        dimensions: {}
      },
      {
        label: "Interest, net",
        tag: "us-gaap:InterestIncomeExpenseNonoperatingNet",
        dimensions: {}
      },
      {
        label: "Earnings before income taxes",
        tag: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        dimensions: {}
      },
      {
        label: "Income tax expense",
        tag: "us-gaap:IncomeTaxExpenseBenefit",
        dimensions: {}
      },
      {
        label: "Earnings from continuing operations",
        tag: "us-gaap:IncomeLossFromContinuingOperations",
        dimensions: {}
      },
      {
        label: "Losses from discontinued operations, net of original reported tax benefits",
        tag: "us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTax",
        dimensions: {}
      },
      {
        label: "Net earnings",
        tag: "us-gaap:NetIncomeLoss",
        dimensions: {}
      }
    ]
  },
  {
    id: "dri-original-primary-layout-3",
    rows: [
      {
        label: "Sales",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      },
      {
        label: "Food and beverage",
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        dimensions: {
          "srt:ProductOrServiceAxis": "us-gaap:FoodAndBeverageMember"
        }
      },
      {
        label: "Restaurant labor",
        tag: "us-gaap:CostDirectLabor",
        dimensions: {}
      },
      {
        label: "Restaurant expenses",
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        dimensions: {
          "srt:ProductOrServiceAxis": "us-gaap:ServiceOtherMember"
        }
      },
      {
        label: "Pre-opening costs",
        tag: "us-gaap:PreOpeningCosts",
        dimensions: {}
      },
      {
        label: "Marketing expenses",
        tag: "us-gaap:MarketingExpense",
        dimensions: {}
      },
      {
        label: "General and administrative expenses",
        tag: "us-gaap:GeneralAndAdministrativeExpense",
        dimensions: {}
      },
      {
        label: "Depreciation and amortization",
        tag: "us-gaap:DepreciationDepletionAndAmortization",
        dimensions: {}
      },
      {
        label: "Impairments and (gain) loss on disposal of assets, net",
        tag: "us-gaap:GainLossOnSalesOfAssetsAndAssetImpairmentCharges",
        dimensions: {}
      },
      {
        label: "Total operating costs and expenses",
        tag: "us-gaap:CostsAndExpenses",
        dimensions: {}
      },
      {
        label: "Operating income",
        tag: "us-gaap:OperatingIncomeLoss",
        dimensions: {}
      },
      {
        label: "Interest, net",
        tag: "us-gaap:InterestIncomeExpenseNonoperatingNet",
        dimensions: {}
      },
      {
        label: "Earnings before income taxes",
        tag: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        dimensions: {}
      },
      {
        label: "Income tax expense",
        tag: "us-gaap:IncomeTaxExpenseBenefit",
        dimensions: {}
      },
      {
        label: "Earnings from continuing operations",
        tag: "us-gaap:IncomeLossFromContinuingOperations",
        dimensions: {}
      },
      {
        label: "Losses from discontinued operations, net of original reported tax benefits",
        tag: "us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTax",
        dimensions: {}
      },
      {
        label: "Net earnings",
        tag: "us-gaap:NetIncomeLoss",
        dimensions: {}
      }
    ]
  },
  {
    id: "dri-original-primary-layout-4",
    rows: [
      {
        label: "Sales",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      },
      {
        label: "Food and beverage",
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        dimensions: {
          "srt:ProductOrServiceAxis": "us-gaap:FoodAndBeverageMember"
        }
      },
      {
        label: "Restaurant labor",
        tag: "us-gaap:CostDirectLabor",
        dimensions: {}
      },
      {
        label: "Restaurant expenses",
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        dimensions: {
          "srt:ProductOrServiceAxis": "us-gaap:ServiceOtherMember"
        }
      },
      {
        label: "Marketing expenses",
        tag: "us-gaap:MarketingExpense",
        dimensions: {}
      },
      {
        label: "General and administrative expenses",
        tag: "us-gaap:GeneralAndAdministrativeExpense",
        dimensions: {}
      },
      {
        label: "Depreciation and amortization",
        tag: "us-gaap:DepreciationDepletionAndAmortization",
        dimensions: {}
      },
      {
        label: "Impairments and disposal of assets, net",
        tag: "us-gaap:GainLossOnSalesOfAssetsAndAssetImpairmentCharges",
        dimensions: {}
      },
      {
        label: "Total operating costs and expenses",
        tag: "us-gaap:CostsAndExpenses",
        dimensions: {}
      },
      {
        label: "Operating income",
        tag: "us-gaap:OperatingIncomeLoss",
        dimensions: {}
      },
      {
        label: "Interest, net",
        tag: "us-gaap:InterestIncomeExpenseNonoperatingNet",
        dimensions: {}
      },
      {
        label: "Earnings before income taxes",
        tag: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        dimensions: {}
      },
      {
        label: "Income tax expense",
        tag: "us-gaap:IncomeTaxExpenseBenefit",
        dimensions: {}
      },
      {
        label: "Earnings from continuing operations",
        tag: "us-gaap:IncomeLossFromContinuingOperations",
        dimensions: {}
      },
      {
        label: "Losses from discontinued operations, net of original reported tax benefits",
        tag: "us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTax",
        dimensions: {}
      },
      {
        label: "Net earnings",
        tag: "us-gaap:NetIncomeLoss",
        dimensions: {}
      }
    ]
  }
];
