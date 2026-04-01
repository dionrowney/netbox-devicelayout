import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("dcim", "0001_squashed"),
    ]

    operations = [
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
                        related_name="devicelayout_layout",
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
                        related_name="devicelayout_layout",
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
                        related_name="devicelayout_layout",
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
    ]
