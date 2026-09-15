import {
  ArrowCounterClockwise,
  Calculator,
  Check,
  ClockCounterClockwise,
  FloppyDisk,
  MagnifyingGlass,
  Package,
  SlidersHorizontal,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { PageHeading } from "../components/PageHeading";
import {
  initialDungeons,
  initialItems,
  initialProbabilities,
} from "../features/loot-calculator/data";
import {
  computeLootTotals,
  getLootItemPrice,
} from "../features/loot-calculator/calculations";
import type { LootDungeonCategory } from "../features/loot-calculator/types";
import {
  getPackDungeonChestTotal,
  lootDungeonToTrackerDungeonId,
  useCastarynStore,
} from "../store/castaryn-store";

const currencyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

const categoryLabels: Record<LootDungeonCategory, string> = {
  armor: "Доспехи",
  weapon: "Оружие",
  relic: "Реликвии",
};

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}

export function LootCalculatorView() {
  const settings = useCastarynStore((state) => state.lootCalculator);
  const prices = useCastarynStore((state) => state.lootPrices);
  const history = useCastarynStore((state) => state.lootHistory);
  const packs = useCastarynStore((state) => state.packs);
  const updateSettings = useCastarynStore(
    (state) => state.updateLootCalculator,
  );
  const toggleDungeon = useCastarynStore((state) => state.toggleLootDungeon);
  const updatePrice = useCastarynStore((state) => state.updateLootPrice);
  const resetPrice = useCastarynStore((state) => state.resetLootPrice);
  const saveCalculation = useCastarynStore(
    (state) => state.saveLootCalculation,
  );
  const deleteCalculation = useCastarynStore(
    (state) => state.deleteLootCalculation,
  );
  const [category, setCategory] = useState<LootDungeonCategory>("relic");
  const [pricesOpen, setPricesOpen] = useState(false);
  const [priceSearch, setPriceSearch] = useState("");

  const inventoryPacks = useMemo(
    () =>
      settings.source === "selected_packs"
        ? packs.filter((pack) => settings.selectedPackIds.includes(pack.id))
        : packs,
    [packs, settings.selectedPackIds, settings.source],
  );
  const inventoryChestCountsByDungeonId = useMemo(
    () =>
      Object.fromEntries(
        settings.selectedDungeonIds.map((dungeonId) => {
          const trackerDungeonId = lootDungeonToTrackerDungeonId[dungeonId];
          const count = trackerDungeonId
            ? inventoryPacks.reduce(
                (sum, pack) =>
                  sum + getPackDungeonChestTotal(pack, trackerDungeonId),
                0,
              )
            : 0;
          return [dungeonId, count];
        }),
      ),
    [inventoryPacks, settings.selectedDungeonIds],
  );
  const inventoryChestCount = useMemo(
    () =>
      Object.values(inventoryChestCountsByDungeonId).reduce(
        (sum, value) => sum + value,
        0,
      ),
    [inventoryChestCountsByDungeonId],
  );
  const effectiveSettings = useMemo(
    () =>
      settings.source === "forecast"
        ? settings
        : {
            ...settings,
            characterCount: inventoryChestCount,
            doubleReward: false,
          },
    [inventoryChestCount, settings],
  );
  const totals = useMemo(
    () =>
      computeLootTotals(
        effectiveSettings,
        initialDungeons,
        initialProbabilities,
        initialItems,
        prices,
        settings.source === "forecast"
          ? undefined
          : inventoryChestCountsByDungeonId,
      ),
    [effectiveSettings, inventoryChestCountsByDungeonId, prices, settings.source],
  );

  const visibleDungeons = initialDungeons.filter(
    (dungeon) => dungeon.category === category,
  );
  const visibleItems = initialItems.filter((item) =>
    item.name.toLocaleLowerCase("ru-RU").includes(
      priceSearch.trim().toLocaleLowerCase("ru-RU"),
    ),
  );

  const handleSave = () => {
    saveCalculation({
      characterCount: settings.characterCount,
      doubleReward: settings.doubleReward,
      source: settings.source,
      inventoryChestCount:
        settings.source === "forecast" ? undefined : inventoryChestCount,
      selectedDungeons: initialDungeons
        .filter((dungeon) => settings.selectedDungeonIds.includes(dungeon.id))
        .map(({ id, name }) => ({ id, name })),
      totalDayValue: totals.totalDayValue,
      totalWeekValue: totals.totalWeekValue,
      totalMonthValue: totals.totalMonthValue,
    });
  };

  return (
    <>
      <PageHeading
        title="Калькулятор фарма"
        description="Оцените ожидаемую стоимость лута и сохраните расчёт в локальную историю."
        action={
          <button
            className="secondary-button"
            type="button"
            onClick={() => setPricesOpen(true)}
          >
            <SlidersHorizontal size={18} />
            Настроить цены
          </button>
        }
      />

      <section className="loot-layout">
        <div className="loot-main">
          <article className="loot-card loot-settings-card">
            <div className="loot-card__heading">
              <div>
                <span className="section-kicker">Параметры</span>
                <h2>Условия расчёта</h2>
              </div>
            </div>

            <div className="loot-controls">
              <div className="loot-source-picker" role="group" aria-label="Источник расчёта">
                {[
                  ["forecast", "Прогноз", "По количеству персонажей"],
                  ["all_inventory", "Весь инвентарь", "Все пачки"],
                  ["selected_packs", "Выбранные пачки", "Только отмеченные"],
                ].map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    className={settings.source === value ? "is-active" : ""}
                    onClick={() => {
                      const source = value as typeof settings.source;
                      updateSettings({
                        source,
                        selectedDungeonIds: settings.selectedDungeonIds,
                      });
                    }}
                  >
                    <Package size={17} />
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                  </button>
                ))}
              </div>
              {settings.source === "forecast" ? (
                <>
                  <label className="loot-number-field">
                    <span>Количество персонажей</span>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={settings.characterCount}
                      onChange={(event) =>
                        updateSettings({
                          characterCount: Number(event.target.value) || 1,
                        })
                      }
                    />
                  </label>
                  <label className="loot-toggle">
                    <input
                      type="checkbox"
                      checked={settings.doubleReward}
                      onChange={(event) =>
                        updateSettings({ doubleReward: event.target.checked })
                      }
                    />
                    <span className="loot-toggle__control" aria-hidden="true" />
                    <span>
                      <strong>Удвоенная награда</strong>
                      <small>Применяется к ежедневным сундукам</small>
                    </span>
                  </label>
                </>
              ) : (
                <div className="loot-inventory-source">
                  <span>Сундуков в расчёте</span>
                  <strong>{inventoryChestCount}</strong>
                  <small>
                    {settings.source === "all_inventory"
                      ? `Сумма по ${packs.length} пачкам`
                      : `Сумма по ${inventoryPacks.length} выбранным пачкам`}
                  </small>
                </div>
              )}
            </div>

            {settings.source === "selected_packs" && (
              <div className="loot-pack-picker">
                {packs.map((pack) => {
                  const selected = settings.selectedPackIds.includes(pack.id);
                  const chestCount = settings.selectedDungeonIds.reduce(
                    (sum, dungeonId) => {
                      const trackerDungeonId =
                        lootDungeonToTrackerDungeonId[dungeonId];
                      return (
                        sum +
                        (trackerDungeonId
                          ? getPackDungeonChestTotal(pack, trackerDungeonId)
                          : 0)
                      );
                    },
                    0,
                  );
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      className={selected ? "is-selected" : ""}
                      aria-pressed={selected}
                      onClick={() =>
                        updateSettings({
                          selectedPackIds: selected
                            ? settings.selectedPackIds.filter((id) => id !== pack.id)
                            : [...settings.selectedPackIds, pack.id],
                        })
                      }
                    >
                      <span className="loot-check">
                        {selected && <Check size={14} weight="bold" />}
                      </span>
                      <span>
                        <strong>{pack.name}</strong>
                        <small>{chestCount} сундуков</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="loot-dungeon-header">
              <div>
                <h3>Подземелья</h3>
                <p>
                  Выбрано: {settings.selectedDungeonIds.length}. Можно сочетать
                  данжи из разных категорий.
                </p>
              </div>
              <div className="loot-category-tabs" role="tablist">
                {(Object.keys(categoryLabels) as LootDungeonCategory[]).map(
                  (value) => {
                    const selectedCount = initialDungeons.filter(
                      (dungeon) =>
                        dungeon.category === value &&
                        settings.selectedDungeonIds.includes(dungeon.id),
                    ).length;
                    return (
                      <button
                        key={value}
                        type="button"
                        className={category === value ? "is-active" : ""}
                        onClick={() => setCategory(value)}
                      >
                        {categoryLabels[value]}
                        {selectedCount > 0 && <span>{selectedCount}</span>}
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            <div className="loot-dungeon-grid">
              {visibleDungeons.map((dungeon) => {
                const selected = settings.selectedDungeonIds.includes(
                  dungeon.id,
                );
                return (
                  <button
                    type="button"
                    key={dungeon.id}
                    className={
                      selected
                        ? "loot-dungeon-option is-selected"
                        : "loot-dungeon-option"
                    }
                    onClick={() => toggleDungeon(dungeon.id)}
                    aria-pressed={selected}
                  >
                    <span className="loot-check">
                      {selected && <Check size={14} weight="bold" />}
                    </span>
                    <span>
                      <strong>{dungeon.name}</strong>
                      <small>Около {dungeon.timeMinutes} мин.</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </article>

          <article className="loot-card">
            <div className="loot-card__heading">
              <div>
                <span className="section-kicker">Результат</span>
                <h2>Доходность подземелий</h2>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={handleSave}
              >
                <FloppyDisk size={18} />
                Сохранить расчёт
              </button>
            </div>
            <div className="loot-table-wrap">
              <table className="loot-table">
                <thead>
                  <tr>
                    <th>Подземелье</th>
                    <th>{settings.source === "forecast" ? "За день" : "Стоимость запаса"}</th>
                    <th>{settings.source === "forecast" ? "За неделю" : "Сундуков"}</th>
                    <th>{settings.source === "forecast" ? "В минуту" : "За сундук"}</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.rows.map((row) => (
                    <tr key={row.dungeonId}>
                      <td>
                        <strong>{row.dungeon.name}</strong>
                        <span>{categoryLabels[row.dungeon.category]}</span>
                      </td>
                      <td>{formatCurrency(row.dayValue)}</td>
                      <td>
                        {settings.source === "forecast"
                          ? formatCurrency(row.weekValue)
                          : inventoryChestCountsByDungeonId[row.dungeonId] ?? 0}
                      </td>
                      <td>
                        {settings.source === "forecast"
                          ? formatCurrency(row.profitPerMinute)
                          : formatCurrency(
                              (inventoryChestCountsByDungeonId[row.dungeonId] ??
                                0) > 0
                                ? row.dayValue /
                                  (inventoryChestCountsByDungeonId[
                                    row.dungeonId
                                  ] ?? 1)
                                : 0,
                            )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="loot-disclaimer">
              Расчёт основан на математическом ожидании. Фактический лут может
              отличаться. Базовые цены — снимок на 03.02.2026.
            </p>
          </article>
        </div>

        <aside className="loot-sidebar">
          <article className="loot-summary">
            <div className="loot-summary__icon">
              <Calculator size={22} />
            </div>
            <span>
              {settings.source === "forecast"
                ? "Ожидаемо за день"
                : "Ожидаемая стоимость запаса"}
            </span>
            <strong>{formatCurrency(totals.totalDayValue)}</strong>
            <small>игровой валюты</small>
            <div className="loot-summary__rows">
              {settings.source === "forecast" ? (
                <>
                  <div>
                    <span>За неделю</span>
                    <strong>{formatCurrency(totals.totalWeekValue)}</strong>
                  </div>
                  <div>
                    <span>За 30 дней</span>
                    <strong>{formatCurrency(totals.totalMonthValue)}</strong>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span>Сундуков учтено</span>
                    <strong>{inventoryChestCount}</strong>
                  </div>
                  <div>
                    <span>Пачек учтено</span>
                    <strong>{inventoryPacks.length}</strong>
                  </div>
                </>
              )}
            </div>
          </article>

          <article className="loot-card loot-history">
            <div className="loot-history__heading">
              <div>
                <span className="section-kicker">История</span>
                <h2>Расчёты</h2>
              </div>
              <ClockCounterClockwise size={20} />
            </div>
            {history.length === 0 ? (
              <div className="loot-history__empty">
                <p>Сохранённых расчётов пока нет.</p>
                <span>Они останутся на этом компьютере.</span>
              </div>
            ) : (
              <div className="loot-history__list">
                {history.map((entry) => (
                  <div className="loot-history-entry" key={entry.id}>
                    <div>
                      <time>{dateFormatter.format(new Date(entry.createdAt))}</time>
                      <strong>
                        {formatCurrency(entry.totalDayValue)}
                        {entry.source === "forecast" || !entry.source
                          ? " / день"
                          : " стоимость запаса"}
                      </strong>
                      <span>
                        {entry.selectedDungeons.length} подземелий ·{" "}
                        {entry.source === "forecast" || !entry.source
                          ? `${entry.characterCount} персонажей`
                          : `${entry.inventoryChestCount ?? 0} сундуков`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => {
                        if (window.confirm("Удалить сохранённый расчёт?")) {
                          deleteCalculation(entry.id);
                        }
                      }}
                      aria-label="Удалить расчёт"
                    >
                      <Trash size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
        </aside>
      </section>

      {pricesOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="loot-price-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="loot-prices-title"
          >
            <header>
              <div>
                <span className="section-kicker">Локальные настройки</span>
                <h2 id="loot-prices-title">Цены предметов</h2>
                <p>Изменения влияют только на расчёты на этом компьютере.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setPricesOpen(false)}
                aria-label="Закрыть"
              >
                <X size={19} />
              </button>
            </header>
            <label className="loot-price-search">
              <MagnifyingGlass size={18} />
              <input
                value={priceSearch}
                onChange={(event) => setPriceSearch(event.target.value)}
                placeholder="Найти предмет"
                autoFocus
              />
            </label>
            <div className="loot-price-list">
              {visibleItems.map((item) => {
                const overridden = prices.some(
                  (price) => price.itemId === item.id,
                );
                return (
                  <div className="loot-price-row" key={item.id}>
                    <img src={item.icon} alt="" />
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        Базовая: {formatCurrency(item.basePrice)}
                      </span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={getLootItemPrice(item.id, initialItems, prices)}
                      onChange={(event) =>
                        updatePrice(item.id, Number(event.target.value) || 0)
                      }
                      aria-label={`Цена: ${item.name}`}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      disabled={!overridden}
                      onClick={() => resetPrice(item.id)}
                      aria-label={`Сбросить цену: ${item.name}`}
                    >
                      <ArrowCounterClockwise size={17} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
