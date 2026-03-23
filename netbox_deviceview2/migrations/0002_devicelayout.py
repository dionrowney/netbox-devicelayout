from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("dcim", "0001_squashed"),
        ("netbox_deviceview2", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="DeviceLayout",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ("layout", models.JSONField(blank=True, default=dict)),
                ("modified", models.DateTimeField(auto_now=True)),
                (
                    "device",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="deviceview2_layout",
                        to="dcim.device",
                    ),
                ),
            ],
            options={
                "verbose_name": "Device Layout",
                "verbose_name_plural": "Device Layouts",
            },
        ),
    ]
