# Balance chip

English | [简体中文](https://github.com/AkagiYui/my-dsh-modify/blob/main/packages/balance-chip/README.zh-CN.md)

DeepSeek balance, today's spend and the current peak/off-peak window, shown in
the composer dock, at the foot of the sidebar, and beside each reply. Every seat
can be switched off independently. Part of
[my-dsh-modify](https://github.com/AkagiYui/my-dsh-modify).

Four surfaces:

1. **Composer dock** — a strip after the shipped context entry: balance, today's
   spend, peak or off-peak. On by default and switchable. Click to open the
   details panel.
2. **Sidebar foot** — a second seat at the foot of the sidebar, above
   Settings. When the column is wide it is a full-width row with the balance,
   today's spend and the phase; in the 56px rail it becomes a compact amount
   disc with a peak/off-peak dot. It shares the composer strip's polling and the
   same details panel. On by default and switchable; each seat is switched
   independently.
3. **Assistant actions** — the cost of that turn, next to the reply actions.
   On by default and switchable. Clicking opens the same panel with the turn's
   token breakdown.
4. **Overlay panel** — balance, today's spend, the pricing window, and per-turn
   input / cache / output tokens.

## Install

```text
plugin_manager   action: install_bundle   target: "dsh-balance-chip"
```

## Display switches

Open **Settings → Plugins → Balance chip**; the three switches sit in that
bundle's configuration section:

- **Balance strip below the composer** — the composer dock entry.
- **Balance strip at the sidebar foot** — the optional second strip.
- **Cost after each turn** — the per-reply cost beside the action row.

All three are on by default and independent. The preference is browser-local
(`localStorage["dsh-balance-chip.preferences"]`) because it is a display choice,
not account data. The sidebar strip is naturally absent while the sidebar itself
is hidden (macOS desktop collapse, the narrow-screen drawer), and the rail shows
only a compact amount.

## Where the numbers come from

| Figure | Source |
| --- | --- |
| Balance | `DEEPSEEK_API_KEY` from the Harness credential store, or the signed-in DSH account |
| Today's spend | An observation ledger: each balance drop is spend, each rise is a top-up and is recorded separately so it never cancels spend already observed |
| Turn cost | Every assistant message in the turn, priced at its own instant with its own model's rates |
| Peak window | Beijing time, weekdays 09:00–12:00 and 14:00–18:00 |

The ledger lives at `$DSH_HOME/balance-chip/ledger.json`. It is written
atomically; an unreadable home directory costs you the "today" figure and never
the balance.

## Network and privacy

The Host half registers two read-only routes on the local web server:

| Route | Returns |
| --- | --- |
| `GET /balance-chip/state[?refresh=1]` | Balance, today's usage, phase |
| `GET /balance-chip/models?session=<id>` | The model behind each reply in a session |

Both are behind the Harness connection fence, are `Cache-Control: no-store`, and
return a JSON error rather than a 500 if the fence itself is unavailable. The
only outbound request is `https://api.deepseek.com/user/balance` with your key,
and the key never leaves the Host process — it is not sent to the browser.

## Accuracy

Cost is an **estimate** from list prices (CNY per million tokens) as of
2026-09-10, in 8-decimal fixed point, with weekend and holiday valley pricing.
Discounts, grants and per-account pricing are not modelled, so the per-turn
figure can differ from your invoice. Balance and today's spend are read from the
account itself and are exact within the polling interval (30s cache).

## Compatibility

Built and verified against **DeepSeek Harness 0.2.1-rc.5**. It depends on the
`credentials`, `deepseekAccount`, `webServer` and `connection` services, and on
`session/event` carrying the model name; a Harness that renames any of those
breaks the chip's data path while the UI keeps rendering. The sidebar strip also
needs the `sidebar.footer.action` and `settings.general.item` slots; on a
Harness that does not declare them, those two registrations simply never
activate and the composer strip still works.

## License

MIT
