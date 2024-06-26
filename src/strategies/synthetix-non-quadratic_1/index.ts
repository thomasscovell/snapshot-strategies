import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import { Contract } from '@ethersproject/contracts';
import { Provider } from '@ethersproject/providers';
import { subgraphRequest } from '../../utils';
import {
  DebtCacheABI,
  debtL1,
  debtL2,
  returnGraphParams,
  SNXHoldersResult,
  SynthetixStateABI
} from '../synthetix/helper';

export const author = 'andytcf';
export const version = '1.0.0';

const MED_PRECISE_UNIT = 1e18;

// @TODO: check if most-up-to-date version (using https://contracts.synthetix.io/SynthetixState)
const SynthetixStateContractAddress =
  '0x4b9Ca5607f1fF8019c1C6A3c2f0CC8de622D5B82';
// @TODO: check if most-up-to-date version (using http://contracts.synthetix.io/DebtCache)
const DebtCacheContractAddress = '0x9D5551Cd3425Dd4585c3E7Eb7E4B98902222521E';

const defaultGraphs = {
  '1': 'https://api.thegraph.com/subgraphs/name/synthetixio-team/synthetix',
  '10': 'https://subgrapher.snapshot.org/subgraph/arbitrum/39nXvA89wrgSz7vRAq6uxmvYn2CTNDuSfXJue3m7PVKA'
};

const loadLastDebtLedgerEntry = async (
  provider: Provider,
  snapshot: number | string
) => {
  const contract = new Contract(
    SynthetixStateContractAddress,
    SynthetixStateABI,
    provider
  );

  const lastDebtLedgerEntry = await contract.lastDebtLedgerEntry({
    blockTag: snapshot
  });

  return BigNumber.from(lastDebtLedgerEntry);
};

const loadL1TotalDebt = async (
  provider: Provider,
  snapshot: number | string
) => {
  const contract = new Contract(
    DebtCacheContractAddress,
    DebtCacheABI,
    provider
  );

  const currentDebtObject = await contract.currentDebt({
    blockTag: snapshot
  });

  return Number(currentDebtObject.debt) / MED_PRECISE_UNIT;
};

export async function strategy(
  _space,
  _network,
  _provider,
  _addresses,
  _options,
  snapshot
) {
  const score = {};
  const blockTag = typeof snapshot === 'number' ? snapshot : 'latest';

  /* Global Constants */

  const totalL1Debt = await loadL1TotalDebt(_provider, snapshot); // (high-precision 1e18)
  const lastDebtLedgerEntry = await loadLastDebtLedgerEntry(
    _provider,
    snapshot
  );

  /* EDIT THESE FOR OVM */

  // @TODO update the currentDebt for the snapshot from (https://contracts.synthetix.io/ovm/DebtCache)
  // const totalL2Debt = 48646913;
  const totalL2Debt = _options.totalL2Debt;
  // @TODO update the lastDebtLedgerEntry from (https://contracts.synthetix.io/ovm/SynthetixState)
  // const lastDebtLedgerEntryL2 = 9773647546760863848975891;
  const lastDebtLedgerEntryL2 = _options.lastDebtLedgerEntryL2;
  // @TODO update the comparison between OVM:ETH c-ratios at the time of snapshot
  const normalisedL2CRatio = 500 / 400;
  // @TODO update the L2 block number to use
  // const L2BlockNumber = 919219;
  const L2BlockNumber = _options.L2BlockNumber;

  const scaledTotalL2Debt = totalL2Debt * normalisedL2CRatio;

  /* --------------- */

  /* Using the subgraph, we get the relevant L1 calculations */

  const l1Results = (await subgraphRequest(
    defaultGraphs[1],
    returnGraphParams(blockTag, _addresses)
  )) as SNXHoldersResult;

  if (l1Results && l1Results.snxholders) {
    for (let i = 0; i < l1Results.snxholders.length; i++) {
      const holder = l1Results.snxholders[i];
      const vote = await debtL1(
        holder.initialDebtOwnership,
        holder.debtEntryAtIndex,
        totalL1Debt,
        scaledTotalL2Debt,
        lastDebtLedgerEntry,
        false
      );
      score[getAddress(holder.id)] = vote;
    }
  }

  /* Using the subgraph, we get the relevant L2 calculations */

  const l2Results = (await subgraphRequest(
    defaultGraphs[10],
    returnGraphParams(L2BlockNumber, _addresses)
  )) as SNXHoldersResult;

  if (l2Results && l2Results.snxholders) {
    for (let i = 0; i < l2Results.snxholders.length; i++) {
      const holder = l2Results.snxholders[i];

      const vote = await debtL2(
        holder.initialDebtOwnership,
        holder.debtEntryAtIndex,
        totalL1Debt,
        scaledTotalL2Debt,
        lastDebtLedgerEntryL2,
        false
      );

      if (score[getAddress(holder.id)]) {
        score[getAddress(holder.id)] += vote;
      } else {
        score[getAddress(holder.id)] = vote;
      }
    }
  }

  return score || {};
}
