import django.db.models.deletion
from django.db import migrations, models


def rename_or_create_tables(apps, schema_editor):
    """
    Handles both upgrade (rename from netbox_deviceview2) and fresh install.
    If the old tables exist they are renamed in-place so all saved layouts are preserved.
    """
    from django.db import connection

    old_prefix = "netbox_deviceview2"
    new_prefix = "netbox_devicelayout"
    tables = ["devicetypelayout", "moduletypelayout", "devicelayout"]

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = %s)",
            [f"{old_prefix}_{tables[0]}"],
        )
        old_exists = cursor.fetchone()[0]

    if old_exists:
        # Upgrade path: rename old tables and update migration history
        with connection.cursor() as cursor:
            for table in tables:
                cursor.execute(
                    f'ALTER TABLE "{old_prefix}_{table}" RENAME TO "{new_prefix}_{table}"'
                )
            cursor.execute(
                "UPDATE django_migrations SET app = %s WHERE app = %s",
                [new_prefix, old_prefix],
            )
    else:
        # Fresh install: create tables via the schema editor
        for model_name in ["DeviceTypeLayout", "ModuleTypeLayout", "DeviceLayout"]:
            model = apps.get_model("netbox_devicelayout", model_name)
            schema_editor.create_model(model)


def reverse_rename_tables(apps, schema_editor):
    from django.db import connection

    old_prefix = "netbox_deviceview2"
    new_prefix = "netbox_devicelayout"
    tables = ["devicetypelayout", "moduletypelayout", "devicelayout"]

    with connection.cursor() as cursor:
        for table in tables:
            cursor.execute(
                f'ALTER TABLE "{new_prefix}_{table}" RENAME TO "{old_prefix}_{table}"'
            )
        cursor.execute(
            "UPDATE django_migrations SET app = %s WHERE app = %s",
            [old_prefix, new_prefix],
        )


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("dcim", "0001_squashed"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name="DeviceTypeLayout",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True,
                                primary_key=True,
                                serialize=False,
                                verbose_name="ID",
                            ),
                        ),
                        (
                            "device_type",
                            models.OneToOneField(
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="deviceview2_layout",
                                to="dcim.devicetype",
                            ),
                        ),
                        ("layout", models.JSONField(blank=True, default=dict)),
                        ("modified", models.DateTimeField(auto_now=True)),
                    ],
                    options={
                        "verbose_name": "Device Type Layout",
                        "verbose_name_plural": "Device Type Layouts",
                    },
                ),
                migrations.CreateModel(
                    name="ModuleTypeLayout",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True,
                                primary_key=True,
                                serialize=False,
                                verbose_name="ID",
                            ),
                        ),
                        (
                            "module_type",
                            models.OneToOneField(
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="deviceview2_layout",
                                to="dcim.moduletype",
                            ),
                        ),
                        ("layout", models.JSONField(blank=True, default=dict)),
                        ("modified", models.DateTimeField(auto_now=True)),
                    ],
                    options={
                        "verbose_name": "Module Type Layout",
                        "verbose_name_plural": "Module Type Layouts",
                    },
                ),
                migrations.CreateModel(
                    name="DeviceLayout",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True,
                                primary_key=True,
                                serialize=False,
                                verbose_name="ID",
                            ),
                        ),
                        (
                            "device",
                            models.OneToOneField(
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="deviceview2_layout",
                                to="dcim.device",
                            ),
                        ),
                        ("layout", models.JSONField(blank=True, default=dict)),
                        ("modified", models.DateTimeField(auto_now=True)),
                    ],
                    options={
                        "verbose_name": "Device Layout",
                        "verbose_name_plural": "Device Layouts",
                    },
                ),
            ],
            database_operations=[
                migrations.RunPython(rename_or_create_tables, reverse_rename_tables),
            ],
        ),
    ]
