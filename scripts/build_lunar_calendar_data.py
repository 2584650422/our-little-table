"""Generate offline lunar-calendar facts using the backend's pinned lunardate package.
Run: server/.venv/bin/python scripts/build_lunar_calendar_data.py
"""
import json
from datetime import date
from pathlib import Path
from lunardate import LunarDate

rows = []
for year in range(1900, 2100):
    leap = LunarDate.leapMonthForYear(year) or 0
    lengths = []
    for month in range(1, 13):
        for is_leap in ([False, True] if month == leap else [False]):
            try:
                LunarDate(year, month, 30, is_leap).toSolarDate()
                lengths.append(30)
            except ValueError:
                lengths.append(29)
    bits = sum((days == 30) << index for index, days in enumerate(lengths))
    rows.append([(LunarDate(year, 1, 1).toSolarDate() - date(1970, 1, 1)).days, leap, bits])
output = Path(__file__).resolve().parents[1] / 'miniprogram/assets/lunar-years.js'
output.write_text('// Generated lunar calendar facts, years 1900–2099. See scripts/build_lunar_calendar_data.py.\nmodule.exports = ' + json.dumps(rows, separators=(',', ':')) + '\n')
