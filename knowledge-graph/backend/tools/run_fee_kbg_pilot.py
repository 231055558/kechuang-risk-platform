import argparse
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.fee_kbg import DEFAULT_CONFIG_PATH, run_cambricon_fee_kbg


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the evidence-grounded Cambricon FEE-KBG pilot snapshot."
    )
    parser.add_argument("--run-id", required=True, help="Unique, rerunnable graph snapshot id.")
    parser.add_argument("--stock-code", default="688256", help="Pilot is restricted to 688256.")
    parser.add_argument("--db", default="data/risk_data.sqlite", help="SQLite path relative to project root.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="FEE-KBG pilot configuration path.")
    args = parser.parse_args()
    db_path = Path(args.db)
    if not db_path.is_absolute():
        db_path = PROJECT_ROOT / db_path
    config_path = Path(args.config)
    if not config_path.is_absolute():
        config_path = PROJECT_ROOT / config_path
    result = run_cambricon_fee_kbg(
        db_path,
        args.run_id,
        stock_code=args.stock_code,
        config_path=config_path,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
