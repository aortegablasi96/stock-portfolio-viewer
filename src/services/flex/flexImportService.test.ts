import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flexImportService } from './flexImportService'
import { flexRepository } from '@repositories/flex/flexRepository'
import { ValidationError } from '@shared/errors'
import type { FlexStatement, FlexStatementImport } from '@shared/domain/flex'

vi.mock('@repositories/flex/flexRepository', () => ({
  flexRepository: {
    readAndParse: vi.fn(),
    persist: vi.fn(),
    clearAll: vi.fn(),
  },
}))

const mockRepo = vi.mocked(flexRepository)

/** Minimal statement stub — the service never inspects the record collections. */
function statement(accountId: string, fromDate: number): FlexStatement {
  return {
    accountId,
    fromDate,
    toDate: fromDate + 1,
    period: 'YearToDate',
    whenGenerated: 1,
    baseCurrency: 'EUR',
    navChange: null,
    openPositions: [],
    priorPeriodPositions: [],
    trades: [],
    lots: [],
    cashTransactions: [],
    performanceSummaries: [],
    securities: [],
    openDividendAccruals: [],
    equitySummaries: [],
  }
}

function importResult(overrides: Partial<FlexStatementImport>): FlexStatementImport {
  const nil = { inserted: 0, skipped: 0 }
  return {
    filename: 'f.xml',
    accountId: 'U1',
    fromDate: 0,
    toDate: 1,
    period: 'YearToDate',
    alreadyImported: false,
    records: {
      navChanges: nil,
      openPositions: nil,
      priorPeriodPositions: nil,
      trades: nil,
      lots: nil,
      cashTransactions: nil,
      performanceSummaries: nil,
      securities: nil,
      openDividendAccruals: nil,
      equitySummaries: nil,
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('flexImportService.import', () => {
  it('parses each file and persists every statement, aggregating the summary', () => {
    mockRepo.readAndParse.mockImplementation((path) =>
      path.endsWith('a.xml') ? [statement('U1', 0)] : [statement('U2', 10)],
    )
    mockRepo.persist.mockImplementation((s, filename) =>
      importResult({ accountId: s.accountId, filename }),
    )

    const summary = flexImportService.import(['/tmp/a.xml', '/tmp/b.xml'])

    expect(mockRepo.readAndParse).toHaveBeenCalledTimes(2)
    expect(mockRepo.persist).toHaveBeenCalledTimes(2)
    // The basename is passed to persist, not the full path.
    expect(mockRepo.persist).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'U1' }), 'a.xml')
    expect(summary.statements.map((s) => s.accountId)).toEqual(['U1', 'U2'])
  })

  it('flattens multiple statements found in a single file', () => {
    mockRepo.readAndParse.mockReturnValue([statement('U1', 0), statement('U1', 100)])
    mockRepo.persist.mockReturnValue(importResult({}))

    const summary = flexImportService.import(['/tmp/multi.xml'])

    expect(mockRepo.persist).toHaveBeenCalledTimes(2)
    expect(summary.statements).toHaveLength(2)
  })

  it('aborts the whole batch (persists nothing) when any file fails to parse', () => {
    mockRepo.readAndParse.mockImplementation((path) => {
      if (path.endsWith('bad.xml')) throw new ValidationError('not a flex file')
      return [statement('U1', 0)]
    })

    expect(() => flexImportService.import(['/tmp/good.xml', '/tmp/bad.xml'])).toThrow(ValidationError)
    // Parsing is the up-front gate — no statement is persisted once a file is invalid.
    expect(mockRepo.persist).not.toHaveBeenCalled()
  })
})

describe('flexImportService.clearStatements', () => {
  it('delegates the full reset to the repository and reports how many statements were removed', () => {
    mockRepo.clearAll.mockReturnValue(3)

    expect(flexImportService.clearStatements()).toEqual({ removedStatements: 3 })
    expect(mockRepo.clearAll).toHaveBeenCalledTimes(1)
  })

  it('reports zero when there was nothing imported to clear', () => {
    mockRepo.clearAll.mockReturnValue(0)

    expect(flexImportService.clearStatements()).toEqual({ removedStatements: 0 })
  })
})
