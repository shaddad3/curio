from flask import Blueprint

notebooks_bp = Blueprint('notebooks', __name__)

from utk_curio.backend.app.notebooks import routes  # noqa: E402, F401
